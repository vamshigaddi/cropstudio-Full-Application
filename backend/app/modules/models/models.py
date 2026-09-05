"""Models module — AI Fashion Model ORM Entities."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AIFashionModel(Base):
    """Represents a virtual fashion model used for AI try-on and lifestyle generation."""

    __tablename__ = "ai_fashion_models"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    gender: Mapped[str] = mapped_column(String(20), nullable=False, default="female")  # male, female, kids, unisex
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="All-Rounder")  # Indian Ethnic, Western, etc.
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)  # R2 key or relative path
    image_url: Mapped[str] = mapped_column(String(1000), nullable=False)  # Public CDN URL or absolute path
    thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AIFashionModel id={self.id} name={self.name} gender={self.gender} active={self.is_active}>"
