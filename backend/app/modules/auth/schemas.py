"""Auth module — Pydantic schemas for JWT token payloads and current user context."""

from datetime import datetime

from pydantic import BaseModel


class TokenPayload(BaseModel):
    """Decoded JWT token payload from Supabase."""

    sub: str  # User ID (UUID from Supabase Auth)
    email: str | None = None
    role: str = "authenticated"  # Supabase default role
    exp: datetime | None = None
    aud: str | None = None


class CurrentUser(BaseModel):
    """Authenticated user context available to all route handlers."""

    id: str  # Supabase Auth user ID
    email: str | None = None
    role: str = "user"  # Application-level role: user | admin
