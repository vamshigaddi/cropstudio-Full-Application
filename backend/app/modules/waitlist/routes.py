"""Waitlist module — API route handlers.

Public endpoints for waitlist signup and category counts.
Admin-only endpoints for listing entries and CSV export.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.modules.auth.dependencies import require_admin
from app.modules.auth.schemas import CurrentUser
from app.modules.waitlist.schemas import (
    WaitlistCountsResponse,
    WaitlistCreate,
    WaitlistListResponse,
    WaitlistResponse,
)
from app.modules.waitlist.service import WaitlistService

router = APIRouter(prefix="/waitlist", tags=["Waitlist"])


def _get_waitlist_service(session: AsyncSession = Depends(get_db_session)) -> WaitlistService:
    """Build the WaitlistService with its dependencies (DI wiring)."""
    return WaitlistService(session)


@router.post("/", response_model=WaitlistResponse, status_code=201)
async def join_waitlist(
    payload: WaitlistCreate,
    service: WaitlistService = Depends(_get_waitlist_service),
) -> WaitlistResponse:
    """Submit a waitlist signup. Public endpoint — no auth required.

    If the email is already registered for the same category,
    returns the existing entry (idempotent).
    """
    try:
        return await service.create_entry(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/counts", response_model=WaitlistCountsResponse)
async def get_waitlist_counts(
    service: WaitlistService = Depends(_get_waitlist_service),
) -> WaitlistCountsResponse:
    """Get signup counts per category. Public endpoint."""
    return await service.get_counts()


@router.get("/", response_model=WaitlistListResponse)
async def list_waitlist_entries(
    category: str | None = Query(None, description="Filter by category"),
    email: str | None = Query(None, description="Search by email"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: CurrentUser = Depends(require_admin),
    service: WaitlistService = Depends(_get_waitlist_service),
) -> WaitlistListResponse:
    """List all waitlist entries. Admin only."""
    return await service.list_entries(
        category=category, email=email, limit=limit, offset=offset
    )


@router.get("/export")
async def export_waitlist_csv(
    category: str | None = Query(None, description="Filter by category"),
    _admin: CurrentUser = Depends(require_admin),
    service: WaitlistService = Depends(_get_waitlist_service),
):
    """Export waitlist entries as CSV. Admin only."""
    csv_content = await service.export_csv(category=category)

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=waitlist_export.csv"
        },
    )
