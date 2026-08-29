"""Prompts module — Pydantic schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptVersionResponse(BaseModel):
    """API response schema for a single prompt version."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: uuid.UUID
    version: int
    content: str
    created_at: datetime


class PromptTemplateResponse(BaseModel):
    """API response schema for a prompt template."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime
    versions: list[PromptVersionResponse] = []


class CreateTemplateRequest(BaseModel):
    """API request schema for creating a new prompt template."""

    name: str = Field(..., max_length=255, pattern=r"^[a-zA-Z0-9_\-]+$")
    description: str | None = None
    content: str = Field(
        ..., description="The template content with placeholder variables like {style}"
    )


class CreateVersionRequest(BaseModel):
    """API request schema for appending a new version to a template."""

    content: str = Field(..., description="The new template content")
