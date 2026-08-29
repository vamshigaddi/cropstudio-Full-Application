"""Auth module — FastAPI dependencies for authentication and authorization.

These dependencies are injected into route handlers via `Depends()`.
They extract the JWT from the Authorization header, verify it,
and return a CurrentUser context.
"""

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError, AuthorizationError
from app.modules.auth.schemas import CurrentUser
from app.modules.auth.service import AuthService

# HTTPBearer extracts the token from "Authorization: Bearer <token>"
_bearer_scheme = HTTPBearer(auto_error=False)


def _get_auth_service(settings: Settings = Depends(get_settings)) -> AuthService:
    """Create an AuthService instance (DI-friendly)."""
    return AuthService(settings)


from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db_session
from app.modules.users.repository import UserRepository

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    auth_service: AuthService = Depends(_get_auth_service),
    db: AsyncSession = Depends(get_db_session),
) -> CurrentUser:
    """FastAPI dependency: extract and verify the JWT, return CurrentUser.

    Usage in routes:
        @router.get("/protected")
        async def protected(user: CurrentUser = Depends(get_current_user)):
            ...
    """
    if credentials is None:
        raise AuthenticationError(message="Authorization header missing")

    token_payload = auth_service.verify_token(credentials.credentials)

    # 1. Fetch user role from database
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(token_payload.sub)

    if user:
        app_role = user.role
    else:
        # Fallback for new/unsynced users
        app_role = "user"
        # Admin role can be set via Supabase user metadata or custom claims
        # For ease of testing, emails ending in @admin.com or matching admin@example.com are given admin privileges
        if token_payload.role == "service_role" or (
            token_payload.email and (
                token_payload.email.endswith("@admin.com") or token_payload.email == "admin@example.com"
            )
        ):
            app_role = "admin"

    return CurrentUser(
        id=token_payload.sub,
        email=token_payload.email,
        role=app_role,
    )


async def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """FastAPI dependency: ensures the current user has admin privileges.

    Usage in routes:
        @router.get("/admin-only")
        async def admin_endpoint(user: CurrentUser = Depends(require_admin)):
            ...
    """
    if user.role != "admin":
        raise AuthorizationError(message="Admin privileges required")
    return user
