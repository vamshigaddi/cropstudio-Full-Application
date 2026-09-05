"""Models module — API routes for public listing and admin management."""

import uuid
from typing import Annotated
from collections.abc import Sequence

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.integrations.storage.factory import get_storage_provider
from app.modules.auth.dependencies import require_admin
from app.modules.auth.schemas import CurrentUser
from app.modules.models.models import AIFashionModel
from app.modules.models.repository import ModelRepository
from app.modules.models.schemas import (
    AIFashionModelResponse,
    CreateAIFashionModelRequest,
    UpdateAIFashionModelRequest,
)

router = APIRouter(prefix="/models", tags=["AI Fashion Models"])

# Default fallback seed models
DEFAULT_SEEDS = [
    {
        "name": "Alex",
        "gender": "male",
        "category": "Western Casual",
        "storage_path": "models/avatar-male.png",
        "image_url": "/images/avatar-male.png",
        "display_order": 1,
    },
    {
        "name": "Priya",
        "gender": "female",
        "category": "Indian Ethnic & Western",
        "storage_path": "models/avatar-female.png",
        "image_url": "/images/avatar-female.png",
        "display_order": 2,
    },
    {
        "name": "Tanuj",
        "gender": "male",
        "category": "Editorial & Streetwear",
        "storage_path": "models/tanuj.jpeg",
        "image_url": "/images/tanuj.jpeg",
        "display_order": 3,
    },
    {
        "name": "Maya",
        "gender": "kids_female",
        "category": "Kids Ethnic & Casual",
        "storage_path": "models/avatar-kids-female.jpg",
        "image_url": "/images/avatar-kids-female.jpg",
        "display_order": 4,
    },
    {
        "name": "Aarav",
        "gender": "kids_male",
        "category": "Kids Casual & Sportswear",
        "storage_path": "models/avatar-kids-male.jpg",
        "image_url": "/images/avatar-kids-male.jpg",
        "display_order": 5,
    },
]


async def ensure_default_models_seeded(repo: ModelRepository) -> None:
    """Auto-seed default models if the table is empty or missing kids models."""
    existing_models = await repo.list_all_admin()
    existing_names = {m.name for m in existing_models}
    for seed in DEFAULT_SEEDS:
        if seed["name"] not in existing_names:
            await repo.create(
                name=seed["name"],
                gender=seed["gender"],
                category=seed["category"],
                storage_path=seed["storage_path"],
                image_url=seed["image_url"],
                display_order=seed["display_order"],
            )


@router.get("/", response_model=list[AIFashionModelResponse])
async def list_active_models(
    gender: str | None = None,
    session: AsyncSession = Depends(get_db_session),
) -> Sequence[AIFashionModel]:
    """List all active AI fashion models for try-on and lifestyle generation."""
    repo = ModelRepository(session)
    await ensure_default_models_seeded(repo)
    return await repo.list_active(gender=gender)


@router.get("/admin/all", response_model=list[AIFashionModelResponse])
async def list_all_models_admin(
    _admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
) -> Sequence[AIFashionModel]:
    """List all fashion models (including inactive) for admin management."""
    repo = ModelRepository(session)
    await ensure_default_models_seeded(repo)
    return await repo.list_all_admin()


@router.post("/admin/upload", response_model=AIFashionModelResponse, status_code=status.HTTP_201_CREATED)
async def upload_model_admin(
    file: Annotated[UploadFile, File(...)],
    name: Annotated[str, Form(...)],
    gender: Annotated[str, Form(...)] = "female",
    category: Annotated[str, Form(...)] = "All-Rounder",
    is_premium: Annotated[bool, Form(...)] = False,
    display_order: Annotated[int, Form(...)] = 0,
    _admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> AIFashionModel:
    """Upload a new AI fashion model to Cloudflare R2 and register in database."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded model image file is empty")

    filename = file.filename or "model.png"
    clean_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    if clean_ext not in ("png", "jpg", "jpeg", "webp"):
        clean_ext = "png"

    safe_name = name.lower().replace(" ", "_")
    storage_key = f"models/{safe_name}_{uuid.uuid4().hex[:8]}.{clean_ext}"
    content_type = file.content_type or f"image/{clean_ext}"

    # 1. Upload bytes to Cloudflare R2 / configured storage provider
    storage = get_storage_provider(settings)
    image_url = await storage.upload(storage_key, content, content_type)

    # 2. Persist record in database
    repo = ModelRepository(session)
    return await repo.create(
        name=name.strip(),
        gender=gender.lower().strip(),
        category=category.strip(),
        storage_path=storage_key,
        image_url=image_url,
        is_active=True,
        is_premium=is_premium,
        display_order=display_order,
    )


@router.patch("/admin/{model_id}", response_model=AIFashionModelResponse)
async def update_model_admin(
    model_id: uuid.UUID,
    payload: UpdateAIFashionModelRequest,
    _admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
) -> AIFashionModel:
    """Update model status, name, gender, or display order."""
    repo = ModelRepository(session)
    model = await repo.get_by_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Fashion model not found")

    return await repo.update(model, **payload.model_dump(exclude_unset=True))


@router.delete("/admin/{model_id}", status_code=status.HTTP_200_OK)
async def delete_model_admin(
    model_id: uuid.UUID,
    _admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    """Delete a fashion model from database and remove its asset from Cloudflare R2."""
    repo = ModelRepository(session)
    model = await repo.get_by_id(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Fashion model not found")

    # Try deleting from storage provider
    if model.storage_path and not model.storage_path.startswith("/images/"):
        storage = get_storage_provider(settings)
        try:
            await storage.delete(model.storage_path)
        except Exception:
            pass

    await repo.delete(model_id)
    return {"status": "success", "message": f"Model '{model.name}' deleted successfully"}
