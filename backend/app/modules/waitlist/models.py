"""Waitlist module — SQLAlchemy database models.

WaitlistEntry: stores interest signups for upcoming product categories.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WaitlistEntry(Base):
    """A single waitlist signup for an upcoming product category."""

    __tablename__ = "waitlist_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("email", "category", name="uq_waitlist_email_category"),
    )

    def __repr__(self) -> str:
        return f"<WaitlistEntry email={self.email} category={self.category}>"
