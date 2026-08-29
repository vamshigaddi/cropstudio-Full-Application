"""Waitlist module — Pydantic schemas for API request/response models."""

from datetime import datetime

from pydantic import BaseModel, Field


# Valid waitlist categories
VALID_CATEGORIES = [
    "jewelry",
    "food_beverage",
    "electronics",
    "furniture",
    "beauty_cosmetics",
    "automotive",
]


class WaitlistCreate(BaseModel):
    """Request body for submitting a waitlist entry."""

    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., pattern=r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
    business_name: str | None = Field(None, max_length=255)
    category: str = Field(..., min_length=1, max_length=100)


class WaitlistResponse(BaseModel):
    """Response after a successful waitlist submission."""

    id: str
    name: str
    email: str
    business_name: str | None = None
    category: str
    created_at: datetime

    model_config = {"from_attributes": True}


class WaitlistCountItem(BaseModel):
    """Count of signups for a single category."""

    category: str
    count: int


class WaitlistCountsResponse(BaseModel):
    """Aggregated signup counts per category."""

    counts: list[WaitlistCountItem]
    total: int


class WaitlistListResponse(BaseModel):
    """Paginated list of waitlist entries (admin only)."""

    entries: list[WaitlistResponse]
    total: int
