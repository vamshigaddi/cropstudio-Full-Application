"""Models module — Pydantic schemas."""

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class AIFashionModelResponse(BaseModel):
    """Schema for returning AI fashion model information."""

    id: uuid.UUID
    name: str
    gender: str
    category: str
    storage_path: str
    image_url: str
    thumbnail_url: str | None = None
    is_active: bool
    is_premium: bool
    display_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CreateAIFashionModelRequest(BaseModel):
    """Request payload for creating/registering an AI model without file upload."""

    name: str
    gender: str = "female"
    category: str = "All-Rounder"
    storage_path: str
    image_url: str
    thumbnail_url: str | None = None
    is_active: bool = True
    is_premium: bool = False
    display_order: int = 0


class UpdateAIFashionModelRequest(BaseModel):
    """Request payload for updating an existing AI model."""

    name: str | None = None
    gender: str | None = None
    category: str | None = None
    is_active: bool | None = None
    is_premium: bool | None = None
    display_order: int | None = None
