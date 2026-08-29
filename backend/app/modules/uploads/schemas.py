"""Uploads module — API request/response schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class UploadResponse(BaseModel):
    """Response containing uploaded image metadata and access URL."""

    id: UUID
    original_filename: str
    file_size_bytes: int
    content_type: str
    width: int | None
    height: int | None
    url: str  # The signed URL or local path to access the image
    created_at: datetime

    model_config = {"from_attributes": True}


class PresignedUrlRequest(BaseModel):
    """Request body for generating a presigned URL."""

    filename: str
    content_type: str
    file_size_bytes: int


class PresignedUrlResponse(BaseModel):
    """Response containing the presigned URL for direct upload."""

    image_id: UUID
    upload_url: str  # Use this with PUT to upload the file
    access_url: str  # Use this to access the file later (may need signing again)


class ProcessedAssetResponse(BaseModel):
    """Response containing processed asset (generated image) metadata and URL."""

    id: UUID
    batch_id: UUID
    image_id: UUID
    generation_mode: str
    result_url: str | None = None
    input_image_url: str
    status: str
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
