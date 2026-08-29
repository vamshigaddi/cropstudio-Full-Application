"""Users module — Pydantic schemas for API request/response models."""

from datetime import datetime

from pydantic import BaseModel, Field

# ─── Response Schemas ───


class ProfileResponse(BaseModel):
    """Profile data returned in API responses."""

    display_name: str | None = None
    avatar_url: str | None = None
    subscription_tier: str = "free"
    monthly_image_quota: int = 50
    images_used_this_month: int = 0
    max_batch_size: int = 10
    credit_balance: int = 10
    preferences: dict[str, object] | None = None
    subscription_period_start: datetime | None = None
    subscription_period_end: datetime | None = None
    pending_downgrade_tier: str | None = None

    model_config = {"from_attributes": True}



import uuid

class UserResponse(BaseModel):
    """User data returned in API responses."""

    id: uuid.UUID | str
    email: str | None = None
    role: str = "user"
    profile: ProfileResponse | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


# ─── Request Schemas ───


class UpdateProfileRequest(BaseModel):
    """Request body for updating user profile."""

    display_name: str | None = Field(None, max_length=255)
    avatar_url: str | None = Field(None, max_length=2048)
    preferences: dict[str, object] | None = None


class UsersListResponse(BaseModel):
    """Response containing a list of users and the total count matching filter."""
    users: list[UserResponse]
    total: int


class AdminStatsResponse(BaseModel):
    """Response containing statistics for the admin dashboard."""
    total_users: int
    active_pro_plans: int
    enterprise_plans: int
    avg_credits: float


class ProviderStatusResponse(BaseModel):
    """Status of an AI model provider."""
    provider_name: str
    is_enabled: bool
    is_configured: bool  # True if the API key is present in env


class UpdateProviderStatusRequest(BaseModel):
    """Request body to update provider status."""
    is_enabled: bool


class ModelPricingResponse(BaseModel):
    """Configuration and pricing details of a model."""
    model_name: str
    provider_name: str
    pricing_data: dict[str, object]
    updated_at: datetime

    model_config = {"from_attributes": True}


class UpdateModelPricingRequest(BaseModel):
    """Request payload to create or update model pricing/resolutions."""
    pricing_data: dict[str, object]

