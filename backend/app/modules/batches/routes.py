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


from fastapi.responses import Response

@router.get("/{batch_id}/catalog-csv")
async def export_batch_catalog_csv(
    batch_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Exports and downloads an Amazon/Shopify/Meesho ready CSV catalog sheet for the batch."""
    from sqlalchemy import select
    from app.modules.jobs.models import Job
    from app.modules.uploads.models import Image
    from app.modules.catalog.service import generate_csv_catalog_stream

    stmt = (
        select(Job, Image)
        .join(Image, Job.image_id == Image.id)
        .where(Job.batch_id == batch_id)
        .order_by(Job.created_at)
    )
    result = await session.execute(stmt)
    rows = result.all()

    mode_labels = {
        "try_on": "Virtual Try-On",
        "on_model": "On-Model",
        "folded": "Folded",
        "flat_lay": "Flat Lay",
        "ghost_mannequin": "Ghost Mannequin",
        "lifestyle": "Lifestyle",
        "closeup": "Macro Closeup",
        "white_background": "White Background",
        "background_removal": "Transparent Background",
    }

    items = []
    for idx, (job, img) in enumerate(rows, start=1):
        clean_name = img.original_filename.rsplit(".", 1)[0] if "." in img.original_filename else img.original_filename
        mode_tag = job.generation_mode.replace("_", "-")
        generated_name = f"{clean_name}_{mode_tag}_{idx}.png"

        items.append({
            "generated_filename": generated_name,
            "mode": mode_labels.get(job.generation_mode, job.generation_mode.replace("_", " ").title()),
            "original_filename": img.original_filename,
            "catalog_data": job.catalog_data or {},
        })

    csv_content = generate_csv_catalog_stream(items)
    
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=cropstudio_catalog_batch_{str(batch_id)[:8]}.csv"
        }
    )
