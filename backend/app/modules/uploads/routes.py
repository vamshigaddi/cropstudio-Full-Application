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
                catalog_data=job.catalog_data,
                detected_gender=job.detected_gender,
                detected_garment_type=job.detected_garment_type,
                created_at=job.updated_at,
            )
        )
    return response


from pydantic import BaseModel

class ClassifyImagePayload(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"

@router.post("/classify")
async def classify_garment_endpoint(
    payload: ClassifyImagePayload,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Fast Vision AI pre-classifier for gender, garment category, and model routing."""
    import base64
    from app.modules.uploads.classifier import classify_single_image

    try:
        raw_b64 = payload.image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        
        image_bytes = base64.b64decode(raw_b64)
        result = await classify_single_image(image_bytes, payload.mime_type)
        return result
    except Exception as e:
        return {
            "is_apparel": True,
            "category_type": "apparel",
            "gender": "female",
            "garment_type": "apparel",
            "display_name": "Garment",
            "primary_color": "Multi",
            "pattern": "Solid",
            "recommended_model_gender": "female",
            "recommended_ratio": "3:4",
            "confidence": 0.5,
            "warning_message": None,
            "fallback": True
        }


class GenerateCatalogPayload(BaseModel):
    image_base64: str | None = None
    image_url: str | None = None
    job_id: str | None = None
    mime_type: str = "image/jpeg"

@router.post("/generate-catalog")
async def generate_catalog_copy_endpoint(
    payload: GenerateCatalogPayload,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Generates structured Amazon/Myntra/Shopify catalog copywriting and attributes."""
    import base64
    import httpx
    from uuid import UUID
    from app.modules.catalog.service import generate_catalog_copy
    from app.modules.jobs.models import Job
    from app.modules.storage.factory import StorageFactory

    # 1. Check if job already has catalog_data in database
    target_job = None
    if payload.job_id:
        try:
            job_uuid = UUID(payload.job_id)
            target_job = await session.get(Job, job_uuid)
            if target_job and target_job.catalog_data:
                return target_job.catalog_data
        except Exception:
            pass

    # 2. Extract image bytes from payload or storage
    image_bytes = None
    if payload.image_base64:
        raw_b64 = payload.image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(raw_b64)
    elif payload.image_url and payload.image_url.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(payload.image_url)
                if res.status_code == 200:
                    image_bytes = res.content
        except Exception:
            pass
    
    if not image_bytes and target_job and target_job.result_url:
        try:
            storage = StorageFactory.get_storage()
            image_bytes = await storage.download(target_job.result_url)
        except Exception:
            pass

    # 3. Generate catalog copywriting via AI
    if image_bytes:
        catalog_data = await generate_catalog_copy(image_bytes, payload.mime_type)
    else:
        # Fallback to standard e-commerce copy
        garment = target_job.detected_garment_type if target_job else "Apparel"
        gender = target_job.detected_gender if target_job else "Unisex"
        catalog_data = {
            "title": f"Premium {gender.title()} {garment.title()} - Regular Fit Everyday Wear",
            "short_description": "Crafted from breathable, high-grade fabrics designed for everyday elegance, comfort, and durability.",
            "bullets": [
                f"Fabric & Material: High-quality breathable fabric for all-day comfort",
                f"Design & Style: Modern {garment.title()} silhouette tailored for contemporary fashion aesthetics",
                f"Fit & Feel: Regular comfortable fit offering ease of movement and structure",
                f"Details: Precision stitched seams and premium finishing touches",
                f"Care Instructions: Machine wash cold with like colors, tumble dry low"
            ],
            "attributes": {
                "category": f"{gender.title()} Fashion",
                "sub_category": garment.title(),
                "color": "Standard",
                "pattern": "Solid",
                "fabric": "Cotton Blend",
                "fit_type": "Regular Fit",
                "occasion": "Casual / Work / Daily"
            },
            "search_keywords": [f"{garment} online", f"buy {gender} {garment}", "stylish fashion wear"]
        }

    # 4. Save to job record for instant reuse
    if target_job:
        try:
            target_job.catalog_data = catalog_data
            await session.commit()
        except Exception:
            pass

    return catalog_data


@router.get("/download-file")
async def download_file_endpoint(
    url: str | None = None,
    path: str | None = None,
    filename: str = "image.png",
    settings: Settings = Depends(get_settings),
):
    """Reliable server-side download endpoint for images that bypasses browser CORS restrictions."""
    import httpx
    from fastapi import HTTPException
    from fastapi.responses import Response

    content = None
    media_type = "image/png"

    # 1. Try downloading from storage if path provided
    storage = get_storage_provider(settings)
    target_path = path or (url if url and not url.startswith("http") else None)
    if target_path and storage:
        try:
            content = await storage.download(target_path)
        except Exception:
            pass

    # 2. Try downloading via HTTP URL
    if not content and url and url.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                r = await client.get(url)
                if r.status_code == 200:
                    content = r.content
                    if "content-type" in r.headers:
                        media_type = r.headers["content-type"]
        except Exception:
            pass

    # 3. If URL is an R2 public domain URL, try extracting storage key and download directly from R2
    if not content and url and storage:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            clean_key = parsed.path.lstrip("/")
            if clean_key:
                content = await storage.download(clean_key)
        except Exception:
            pass

    if not content:
        raise HTTPException(status_code=404, detail="File content could not be retrieved")

    safe_filename = filename.replace('"', "").replace("\n", "").replace("\r", "")
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        },
    )


