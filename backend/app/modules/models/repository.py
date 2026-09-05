"""Models module — Database repository."""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.models.models import AIFashionModel


class ModelRepository:
    """Repository handling database operations for AI fashion models."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, model_id: uuid.UUID) -> AIFashionModel | None:
        """Fetch model by primary key."""
        stmt = select(AIFashionModel).where(AIFashionModel.id == model_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_active(self, gender: str | None = None) -> Sequence[AIFashionModel]:
        """List all active models ordered by display_order then created_at."""
        stmt = select(AIFashionModel).where(AIFashionModel.is_active.is_(True))
        if gender and gender.lower() != "all":
            stmt = stmt.where(AIFashionModel.gender == gender.lower())
        stmt = stmt.order_by(AIFashionModel.display_order.asc(), AIFashionModel.created_at.asc())
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def list_all_admin(self) -> Sequence[AIFashionModel]:
        """List all models (including inactive) for admin management."""
        stmt = select(AIFashionModel).order_by(AIFashionModel.display_order.asc(), AIFashionModel.created_at.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def create(
        self,
        name: str,
        gender: str,
        category: str,
        storage_path: str,
        image_url: str,
        thumbnail_url: str | None = None,
        is_active: bool = True,
        is_premium: bool = False,
        display_order: int = 0,
    ) -> AIFashionModel:
        """Create and persist a new AI fashion model."""
        model = AIFashionModel(
            name=name,
            gender=gender,
            category=category,
            storage_path=storage_path,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            is_active=is_active,
            is_premium=is_premium,
            display_order=display_order,
        )
        self.session.add(model)
        await self.session.commit()
        await self.session.refresh(model)
        return model

    async def update(self, model: AIFashionModel, **kwargs) -> AIFashionModel:
        """Update fields on an existing model."""
        for key, value in kwargs.items():
            if value is not None and hasattr(model, key):
                setattr(model, key, value)
        await self.session.commit()
        await self.session.refresh(model)
        return model

    async def delete(self, model_id: uuid.UUID) -> bool:
        """Delete an AI fashion model by ID."""
        stmt = delete(AIFashionModel).where(AIFashionModel.id == model_id)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount > 0
