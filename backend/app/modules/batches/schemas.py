"""Batches module — Pydantic schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CreateBatchRequest(BaseModel):
    """Request to create a new batch."""

    name: str | None = Field(default=None, max_length=255)
    image_ids: list[UUID] = Field(..., min_length=1)
    generation_mode: str | list[str] = Field(..., description="E.g., 'upscale', or list of modes")
    config: dict | None = None


class JobResponse(BaseModel):
    """Response containing a single job's status and result."""

    id: UUID
    image_id: UUID
    generation_mode: str
    status: str
    attempts: int
    error_message: str | None = None
    result_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BatchResponse(BaseModel):
    """Response containing batch summary (used for creation and list views)."""

    id: UUID
    name: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BatchDetailResponse(BaseModel):
    """Response containing batch details with all child jobs."""

    id: UUID
    name: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    total_jobs: int
    completed_jobs: int
    failed_jobs: int
    jobs: list[JobResponse]

    model_config = {"from_attributes": True}
