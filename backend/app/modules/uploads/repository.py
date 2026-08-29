"""Uploads module — Database access."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.uploads.models import Image


class UploadRepository:
    """Database access layer for Image entities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_image(self, image: Image) -> Image:
        """Save a new image record to the database."""
        self._session.add(image)
        await self._session.flush()
        return image

    async def get_by_id(self, image_id: uuid.UUID) -> Image | None:
        """Get an image by its ID."""
        stmt = select(Image).where(Image.id == image_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_images(
        self, user_id: str, limit: int | None = None, offset: int = 0
    ) -> Sequence[Image]:
        """Get a list of images uploaded by the user that have associated jobs."""
        from app.modules.jobs.models import Job
        stmt = (
            select(Image)
            .join(Job, Image.id == Job.image_id)
            .where(Image.user_id == uuid.UUID(user_id))
            .distinct()
            .order_by(Image.created_at.desc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        if offset > 0:
            stmt = stmt.offset(offset)
            
        result = await self._session.execute(stmt)
        return result.scalars().all()
