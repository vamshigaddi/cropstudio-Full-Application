"""Batches module — Database access."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.batches.models import Batch
from app.modules.jobs.models import Job


class BatchRepository:
    """Database access layer for Batch entities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_batch(self, batch: Batch) -> Batch:
        """Save a new batch to the database."""
        self._session.add(batch)
        await self._session.flush()
        return batch

    async def get_by_id(self, batch_id: uuid.UUID) -> Batch | None:
        """Get a batch by ID."""
        return await self._session.get(Batch, batch_id)

    async def get_user_batches(
        self, user_id: str, limit: int = 20, offset: int = 0
    ) -> Sequence[Batch]:
        """Get batches owned by the user."""
        stmt = (
            select(Batch)
            .where(Batch.user_id == uuid.UUID(user_id))
            .order_by(Batch.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_batch_with_jobs(
        self, batch_id: uuid.UUID, user_id: uuid.UUID
    ) -> tuple[Batch | None, Sequence[Job]]:
        """Get a batch and all its child jobs, scoped to the user.

        Returns:
            A tuple of (batch, jobs). batch is None if not found or not owned by user.
        """
        # 1. Fetch the batch and verify ownership
        stmt = select(Batch).where(Batch.id == batch_id, Batch.user_id == user_id)
        result = await self._session.execute(stmt)
        batch = result.scalar_one_or_none()

        if batch is None:
            return None, []

        # 2. Fetch all child jobs
        jobs_stmt = select(Job).where(Job.batch_id == batch_id).order_by(Job.created_at.asc())
        jobs_result = await self._session.execute(jobs_stmt)
        jobs = jobs_result.scalars().all()

        return batch, jobs
