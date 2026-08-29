"""Waitlist module — business logic / service layer."""

import csv
import io
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.waitlist.models import WaitlistEntry
from app.modules.waitlist.schemas import (
    VALID_CATEGORIES,
    WaitlistCountItem,
    WaitlistCountsResponse,
    WaitlistCreate,
    WaitlistListResponse,
    WaitlistResponse,
)

logger = get_logger(__name__)


class WaitlistService:
    """Business logic for waitlist management."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_entry(self, payload: WaitlistCreate) -> WaitlistResponse:
        """Create a new waitlist entry, or return existing if duplicate."""
        if payload.category not in VALID_CATEGORIES:
            raise ValueError(
                f"Invalid category '{payload.category}'. "
                f"Valid categories: {', '.join(VALID_CATEGORIES)}"
            )

        # Use PostgreSQL's ON CONFLICT to handle duplicates gracefully
        stmt = (
            pg_insert(WaitlistEntry)
            .values(
                name=payload.name,
                email=payload.email,
                business_name=payload.business_name,
                category=payload.category,
            )
            .on_conflict_do_nothing(constraint="uq_waitlist_email_category")
            .returning(WaitlistEntry)
        )

        result = await self._session.execute(stmt)
        entry = result.scalar_one_or_none()

        if entry is None:
            # Already existed — fetch existing record
            existing = await self._session.execute(
                select(WaitlistEntry).where(
                    WaitlistEntry.email == payload.email,
                    WaitlistEntry.category == payload.category,
                )
            )
            entry = existing.scalar_one()
            logger.info(
                "waitlist_duplicate_entry",
                email=payload.email,
                category=payload.category,
            )
        else:
            logger.info(
                "waitlist_entry_created",
                email=payload.email,
                category=payload.category,
            )

        return WaitlistResponse(
            id=str(entry.id),
            name=entry.name,
            email=entry.email,
            business_name=entry.business_name,
            category=entry.category,
            created_at=entry.created_at,
        )

    async def get_counts(self) -> WaitlistCountsResponse:
        """Get aggregated signup counts per category."""
        stmt = (
            select(WaitlistEntry.category, func.count(WaitlistEntry.id).label("count"))
            .group_by(WaitlistEntry.category)
        )
        result = await self._session.execute(stmt)
        rows = result.all()

        counts = [WaitlistCountItem(category=row.category, count=row.count) for row in rows]
        total = sum(item.count for item in counts)

        return WaitlistCountsResponse(counts=counts, total=total)

    async def list_entries(
        self,
        category: str | None = None,
        email: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> WaitlistListResponse:
        """List waitlist entries with optional filtering (admin only)."""
        query = select(WaitlistEntry).order_by(WaitlistEntry.created_at.desc())

        if category:
            query = query.where(WaitlistEntry.category == category)
        if email:
            query = query.where(WaitlistEntry.email.ilike(f"%{email}%"))

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self._session.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = query.limit(limit).offset(offset)
        result = await self._session.execute(query)
        entries = result.scalars().all()

        return WaitlistListResponse(
            entries=[
                WaitlistResponse(
                    id=str(e.id),
                    name=e.name,
                    email=e.email,
                    business_name=e.business_name,
                    category=e.category,
                    created_at=e.created_at,
                )
                for e in entries
            ],
            total=total,
        )

    async def export_csv(self, category: str | None = None) -> str:
        """Export waitlist entries as CSV string."""
        query = select(WaitlistEntry).order_by(WaitlistEntry.created_at.desc())
        if category:
            query = query.where(WaitlistEntry.category == category)

        result = await self._session.execute(query)
        entries = result.scalars().all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Name", "Email", "Business Name", "Category", "Signed Up At"])

        for e in entries:
            writer.writerow([
                e.name,
                e.email,
                e.business_name or "",
                e.category,
                e.created_at.isoformat() if e.created_at else "",
            ])

        return output.getvalue()
