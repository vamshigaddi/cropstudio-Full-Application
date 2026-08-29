"""Jobs module — Database access."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.jobs.models import Job


class JobRepository:
    """Database access layer for Job entities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, job_id: uuid.UUID) -> Job | None:
        """Get a job by ID."""
        return await self._session.get(Job, job_id)

    async def get_and_lock_job(self, job_id: uuid.UUID) -> Job | None:
        """Get a job and acquire a row-level lock (FOR UPDATE).

        This prevents race conditions if the queue double-delivers a task.
        """
        stmt = select(Job).where(Job.id == job_id).with_for_update()
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()
