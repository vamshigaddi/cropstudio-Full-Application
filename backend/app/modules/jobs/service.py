"""Jobs module — Service layer."""

import uuid
from typing import TYPE_CHECKING

from app.core.events import (
    EventBus,
    JobCompletedEvent,
    JobFailedEvent,
)
from app.core.logging import get_logger
from app.modules.jobs.repository import JobRepository

if TYPE_CHECKING:
    from app.modules.generation.orchestrator import GenerationOrchestrator

logger = get_logger(__name__)


class JobService:
    """Business logic for handling individual jobs."""

    def __init__(
        self,
        job_repo: JobRepository,
        orchestrator: "GenerationOrchestrator",
        event_bus: EventBus,
    ) -> None:
        self._repo = job_repo
        self._orchestrator = orchestrator
        self._event_bus = event_bus

    async def process_job(self, job_id_str: str, generation_mode: str, config: dict | None = None) -> None:
        """Handle a job execution request from the queue.

        This method is idempotent. If the job is already processing or completed,
        it will skip execution.
        """
        try:
            job_id = uuid.UUID(job_id_str)
        except ValueError:
            logger.error("invalid_job_id", job_id=job_id_str)
            return

        # 1. Lock the job to prevent concurrent execution
        job = await self._repo.get_and_lock_job(job_id)
        if not job:
            logger.error("job_not_found", job_id=job_id_str)
            return

        # 2. Idempotency check
        if job.status in ("processing", "completed", "cancelled"):
            logger.info("job_already_processed_or_processing", job_id=job_id_str, status=job.status)
            return

        if job.status == "failed" and job.attempts >= 3:
            logger.warning("job_max_retries_exceeded", job_id=job_id_str)
            return

        # 3. Mark as processing
        job.status = "processing"
        job.attempts += 1
        await self._repo._session.commit()  # Commit to release the lock immediately

        # 4. Actual execution logic
        logger.info("job_processing_started", job_id=job_id_str, mode=generation_mode)

        try:
            # Re-fetch without lock
            job = await self._repo.get_by_id(job_id)
            if not job:
                return

            await self._orchestrator.execute_job(job, config=config)

            # Mark as completed
            job = await self._repo.get_and_lock_job(job_id)
            if job:
                job.status = "completed"
                await self._repo._session.commit()
                logger.info("job_processing_completed", job_id=job_id_str)

                # 🔔 Emit job.completed event
                await self._event_bus.publish(
                    JobCompletedEvent(
                        job_id=job.id,
                        batch_id=job.batch_id,
                        result_url=job.result_url,
                    )
                )
                await self._check_and_update_batch_status(job.batch_id)

        except Exception as e:
            # Mark as failed
            job = await self._repo.get_and_lock_job(job_id)
            if job:
                job.status = "failed"
                job.error_message = str(e)

                # Refund credits if it is a permanent failure (attempts >= 3)
                # Refund full 10 credits since paid variations now cost 10 credits
                if job.attempts >= 3 and job.generation_mode not in (
                    "background_removal",
                    "white_background",
                ):
                    from sqlalchemy import select
                    from sqlalchemy.orm import joinedload

                    from app.modules.batches.repository import BatchRepository
                    from app.modules.users.models import User

                    batch_repo = BatchRepository(self._repo._session)
                    batch = await batch_repo.get_by_id(job.batch_id)
                    if batch:
                        stmt = (
                            select(User)
                            .options(joinedload(User.profile))
                            .where(User.id == batch.user_id)
                        )
                        result = await self._repo._session.execute(stmt)
                        user = result.unique().scalar_one_or_none()
                        if user and user.profile:
                            # Refund 10 credits per failed job to match the upfront cost
                            user.profile.credit_balance += 10

                await self._repo._session.commit()
                logger.error("job_processing_failed", job_id=job_id_str, error=str(e))

                # 🔔 Emit job.failed event
                await self._event_bus.publish(
                    JobFailedEvent(
                        job_id=job.id,
                        batch_id=job.batch_id,
                        error_message=str(e),
                        attempts=job.attempts,
                    )
                )
                await self._check_and_update_batch_status(job.batch_id)
            raise  # Re-raise to let Cloud Tasks know to retry

    async def _check_and_update_batch_status(self, batch_id: uuid.UUID) -> None:
        """Check if all jobs in a batch are terminal, update batch status, and emit event."""
        from sqlalchemy import func, select
        from app.core.events import BatchCompletedEvent
        from app.modules.batches.repository import BatchRepository
        from app.modules.jobs.models import Job

        # Query job counts for this batch
        stmt = (
            select(Job.status, func.count(Job.id).label("count"))
            .where(Job.batch_id == batch_id)
            .group_by(Job.status)
        )

        result = await self._repo._session.execute(stmt)
        counts = {row.status: row.count for row in result.all()}

        total_jobs = sum(counts.values())
        completed_jobs = counts.get("completed", 0)
        failed_jobs = counts.get("failed", 0)
        cancelled_jobs = counts.get("cancelled", 0)

        # If all jobs are in a terminal state
        if completed_jobs + failed_jobs + cancelled_jobs == total_jobs:
            batch_repo = BatchRepository(self._repo._session)
            batch = await batch_repo.get_by_id(batch_id)
            if batch and batch.status != "completed":
                batch.status = "completed"
                await self._repo._session.commit()

                await self._event_bus.publish(
                    BatchCompletedEvent(
                        batch_id=batch.id,
                        user_id=batch.user_id,
                        total_jobs=total_jobs,
                        completed_jobs=completed_jobs,
                        failed_jobs=failed_jobs,
                    )
                )
