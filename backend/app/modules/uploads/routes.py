"""Uploads module — API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.integrations.storage.factory import get_storage_provider
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import CurrentUser
from app.modules.uploads.repository import UploadRepository
from app.modules.uploads.schemas import ProcessedAssetResponse, PresignedUrlRequest, PresignedUrlResponse, UploadResponse
from app.modules.uploads.service import UploadService

router = APIRouter(prefix="/uploads", tags=["Uploads"])


def _get_upload_service(
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> UploadService:
    """Dependency injection for UploadService."""
    repository = UploadRepository(session)
    storage = get_storage_provider(settings)
    return UploadService(repository, storage)


@router.post("/", response_model=UploadResponse)
async def upload_image_direct(
    file: Annotated[UploadFile, File(...)],
    current_user: CurrentUser = Depends(get_current_user),
    service: UploadService = Depends(_get_upload_service),
) -> UploadResponse:
    """Directly upload an image file.

    Validates the image, stores it in the configured storage provider,
    and creates a database record.
    """
    content = await file.read()

    # file.filename is a str | None in FastAPI, ensure it's a string
    filename = file.filename or "unknown.bin"
    content_type = file.content_type or "application/octet-stream"

    image, url = await service.upload_direct(
        current_user=current_user,
        filename=filename,
        content=content,
        content_type=content_type,
    )

    return UploadResponse(
        id=image.id,
        original_filename=image.original_filename,
        file_size_bytes=image.file_size_bytes,
        content_type=image.content_type,
        width=image.width,
        height=image.height,
        url=url,
        created_at=image.created_at,
    )


@router.post("/presigned", response_model=PresignedUrlResponse)
async def generate_presigned_url(
    request: PresignedUrlRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: UploadService = Depends(_get_upload_service),
) -> PresignedUrlResponse:
    """Generate a presigned URL for direct-to-storage uploading."""
    return await service.get_presigned_url(
        current_user=current_user,
        filename=request.filename,
        content_type=request.content_type,
        file_size_bytes=request.file_size_bytes,
    )


@router.get("/", response_model=list[UploadResponse])
async def list_user_images(
    current_user: CurrentUser = Depends(get_current_user),
    service: UploadService = Depends(_get_upload_service),
) -> list[UploadResponse]:
    """List all original images uploaded by the current user."""
    results = await service.list_images(current_user)

    response = []
    for image, url in results:
        response.append(
            UploadResponse(
                id=image.id,
                original_filename=image.original_filename,
                file_size_bytes=image.file_size_bytes,
                content_type=image.content_type,
                width=image.width,
                height=image.height,
                url=url,
                created_at=image.created_at,
            )
        )
    return response


@router.get("/processed", response_model=list[ProcessedAssetResponse])
async def list_processed_assets(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> list[ProcessedAssetResponse]:
    """List all AI processed images (including completed, failed, and processing jobs) for the user."""
    from uuid import UUID
    from sqlalchemy import select
    from app.modules.batches.models import Batch
    from app.modules.jobs.models import Job
    from app.modules.uploads.models import Image
    from app.integrations.storage.factory import get_storage_provider

    from app.modules.users.models import User

    # Resolve local user ID from Supabase user ID
    user_stmt = select(User.id).where(User.supabase_id == current_user.id)
    user_res = await session.execute(user_stmt)
    local_user_id = user_res.scalar_one_or_none()
    if not local_user_id:
        return []

    stmt = (
        select(Job, Image)
        .join(Batch, Job.batch_id == Batch.id)
        .join(Image, Job.image_id == Image.id)
        .where(
            Batch.user_id == local_user_id
        )
        .order_by(Job.updated_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.all()

    storage = get_storage_provider(settings)
    
    response = []
    for job, img in rows:
        resolved_url = None
        if job.result_url:
            resolved_url = job.result_url
            if storage and not job.result_url.startswith("http"):
                try:
                    resolved_url = await storage.get_signed_url(job.result_url, expiration_seconds=3600)
                except Exception:
                    pass
        
        input_url = img.storage_path
        if storage and not img.storage_path.startswith("http"):
            try:
                input_url = await storage.get_signed_url(img.storage_path, expiration_seconds=3600)
            except Exception:
                pass
        
        response.append(
            ProcessedAssetResponse(
                id=job.id,
                batch_id=job.batch_id,
                image_id=job.image_id,
                generation_mode=job.generation_mode,
                result_url=resolved_url,
                input_image_url=input_url,
                status=job.status,
                error_message=job.error_message,
                created_at=job.updated_at,
            )
        )
    return response
