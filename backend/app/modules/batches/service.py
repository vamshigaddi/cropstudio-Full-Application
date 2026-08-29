"""Batches module — Service layer."""

import uuid

from app.core.exceptions import AuthorizationError, NotFoundError, QuotaExceededError
from app.core.logging import get_logger
from app.integrations.queue.base import QueueProvider
from app.integrations.storage.base import StorageProvider
from app.modules.auth.schemas import CurrentUser
from app.modules.batches.models import Batch
from app.modules.batches.repository import BatchRepository
from app.modules.batches.schemas import BatchDetailResponse, JobResponse
from app.modules.jobs.models import Job
from app.modules.users.repository import UserRepository

logger = get_logger(__name__)


class BatchService:
    """Business logic for handling batches of generation jobs."""

    def __init__(
        self,
        batch_repo: BatchRepository,
        user_repo: UserRepository,
        queue: QueueProvider,
        storage: StorageProvider | None = None,
    ) -> None:
        self._repo = batch_repo
        self._user_repo = user_repo
        self._queue = queue
        self._storage = storage

    async def create_batch(
        self,
        current_user: CurrentUser,
        image_ids: list[uuid.UUID],
        generation_mode: str | list[str],
        name: str | None = None,
        config: dict | None = None,
    ) -> Batch:
        """Create a batch, associated jobs, and enqueue them."""
        # 1. Fetch user profile to check quotas
        user = await self._user_repo.get_by_supabase_id(current_user.id)
        if not user or not user.profile:
            raise AuthorizationError(message="User profile not found. Cannot create batch.")

        # 2. Check quota limits
        if len(image_ids) > user.profile.max_batch_size:
            raise QuotaExceededError(
                message=f"Batch size exceeds your plan limit of {user.profile.max_batch_size} images."
            )

        # Convert to list if it's a single string
        modes = [generation_mode] if isinstance(generation_mode, str) else generation_mode

        # Feature Gating by Subscription Tier
        allowed_free_modes = {"background_removal", "white_background", "upscale"}
        for mode in modes:
            if user.profile.subscription_tier == "free" and mode not in allowed_free_modes:
                raise AuthorizationError(
                    message=f"The generation mode '{mode}' is not available on the Free subscription tier."
                )

        # Credit Validation and Upfront Deduction
        # Each paid variation costs 10 credits per image.
        paid_modes_count = sum(1 for m in modes if m not in ("background_removal", "white_background"))
        if paid_modes_count > 0:
            # We multiply by 10 because paid variations cost 10 credits per image
            required_credits = len(image_ids) * paid_modes_count * 10
            if user.profile.credit_balance < required_credits:
                raise QuotaExceededError(
                    message=f"Insufficient credits. You need {required_credits} credits to generate these images (10 credits per paid variation), but only have {user.profile.credit_balance} credits remaining."
                )
            # Deduct the computed credits from the user's balance
            user.profile.credit_balance -= required_credits

        # 3. Create the batch
        batch = Batch(
            user_id=user.id,
            name=name or f"Batch {len(image_ids)} images",
            status="pending",
        )
        batch = await self._repo.create_batch(batch)

        # 4. Create and enqueue jobs
        for mode in modes:
            for image_id in image_ids:
                job = Job(
                    batch_id=batch.id,
                    image_id=image_id,
                    generation_mode=mode,
                    status="pending",
                )
                self._repo._session.add(job)

        # Commit to ensure jobs are in DB before worker gets triggered
        await self._repo._session.commit()

        # Fetch jobs to update status and enqueue
        from sqlalchemy import select

        stmt = select(Job).where(Job.batch_id == batch.id)
        result = await self._repo._session.execute(stmt)
        jobs = result.scalars().all()

        for job in jobs:
            job.status = "queued"
            
        # Commit the 'queued' status BEFORE triggering the background worker.
        # This prevents the worker from updating to 'processing' only to be overwritten
        # back to 'queued' by the main thread's final transaction commit.
        await self._repo._session.commit()

        for job in jobs:
            payload = {
                "job_id": str(job.id),
                "generation_mode": job.generation_mode,
                "config": config,
            }
            await self._queue.enqueue(
                queue_name="generation-queue",
                target_uri="/api/v1/workers/jobs/process",
                payload=payload,
            )

        return batch

    async def get_batch_details(
        self,
        batch_id: uuid.UUID,
        current_user: CurrentUser,
    ) -> BatchDetailResponse:
        """Get a batch with all its jobs and generate presigned URLs for completed results."""
        user = await self._user_repo.get_by_supabase_id(current_user.id)
        if not user:
            raise AuthorizationError(message="User profile not found. Cannot retrieve batch.")
        batch, jobs = await self._repo.get_batch_with_jobs(batch_id, user.id)

        if batch is None:
            raise NotFoundError(resource="Batch", identifier=str(batch_id))

        # Build job responses, resolving presigned URLs for completed jobs
        job_responses: list[JobResponse] = []
        completed_count = 0
        failed_count = 0

        for job in jobs:
            result_url: str | None = None

            if job.status == "completed":
                completed_count += 1
                # Generate presigned URL if we have a storage provider and a result path
                if self._storage and job.result_url:
                    try:
                        result_url = await self._storage.get_signed_url(
                            job.result_url, expiration_seconds=900
                        )
                    except Exception:
                        logger.warning(
                            "presigned_url_generation_failed",
                            job_id=str(job.id),
                            result_url=job.result_url,
                        )
                        result_url = job.result_url  # Fall back to raw path
            elif job.status == "failed":
                failed_count += 1

            job_responses.append(
                JobResponse(
                    id=job.id,
                    image_id=job.image_id,
                    generation_mode=job.generation_mode,
                    status=job.status,
                    attempts=job.attempts,
                    error_message=job.error_message,
                    result_url=result_url,
                    created_at=job.created_at,
                    updated_at=job.updated_at,
                )
            )

        return BatchDetailResponse(
            id=batch.id,
            name=batch.name,
            status=batch.status,
            created_at=batch.created_at,
            updated_at=batch.updated_at,
            total_jobs=len(jobs),
            completed_jobs=completed_count,
            failed_jobs=failed_count,
            jobs=job_responses,
        )

    async def list_user_batches(
        self,
        current_user: CurrentUser,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Batch]:
        """List all batches belonging to the current user."""
        user = await self._user_repo.get_by_supabase_id(current_user.id)
        if not user:
            raise AuthorizationError(message="User profile not found. Cannot retrieve batches.")
        batches = await self._repo.get_user_batches(
            user_id=str(user.id), limit=limit, offset=offset
        )
        return list(batches)
