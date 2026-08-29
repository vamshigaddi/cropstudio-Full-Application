"""Batches module — API routes."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.integrations.queue.factory import get_queue_provider
from app.integrations.storage.factory import get_storage_provider
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import CurrentUser
from app.modules.batches.repository import BatchRepository
from app.modules.batches.schemas import BatchDetailResponse, BatchResponse, CreateBatchRequest
from app.modules.batches.service import BatchService
from app.modules.users.repository import UserRepository

router = APIRouter(prefix="/batches", tags=["Batches"])


def _get_batch_service(
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> BatchService:
    """Dependency injection for BatchService."""
    batch_repo = BatchRepository(session)
    user_repo = UserRepository(session)
    queue = get_queue_provider(settings, background_tasks)
    storage = get_storage_provider(settings)
    return BatchService(batch_repo, user_repo, queue, storage)


@router.post("/", response_model=BatchResponse)
async def create_batch(
    request: CreateBatchRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: BatchService = Depends(_get_batch_service),
) -> BatchResponse:
    """Create a new batch of generation jobs and enqueue them."""
    batch = await service.create_batch(
        current_user=current_user,
        image_ids=request.image_ids,
        generation_mode=request.generation_mode,
        name=request.name,
        config=request.config,
    )

    return BatchResponse.model_validate(batch)


@router.get("/", response_model=list[BatchResponse])
async def list_batches(
    current_user: CurrentUser = Depends(get_current_user),
    service: BatchService = Depends(_get_batch_service),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[BatchResponse]:
    """List all batches belonging to the current user."""
    batches = await service.list_user_batches(
        current_user=current_user,
        limit=limit,
        offset=offset,
    )
    return [BatchResponse.model_validate(b) for b in batches]


@router.get("/{batch_id}", response_model=BatchDetailResponse)
async def get_batch_details(
    batch_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: BatchService = Depends(_get_batch_service),
) -> BatchDetailResponse:
    """Get batch details including all jobs and their result URLs.

    For completed jobs, the result_url will contain a presigned download URL
    that expires in 15 minutes.
    """
    return await service.get_batch_details(
        batch_id=batch_id,
        current_user=current_user,
    )
