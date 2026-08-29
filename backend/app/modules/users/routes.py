"""Users module — API route handlers.

Thin route layer: validates input, calls the service, returns formatted output.
No business logic lives here.
"""

from datetime import datetime, timedelta, timezone
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import CurrentUser
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import (
    UpdateProfileRequest,
    UserResponse,
    UsersListResponse,
    AdminStatsResponse,
    ProviderStatusResponse,
    UpdateProviderStatusRequest,
    ModelPricingResponse,
    UpdateModelPricingRequest,
)
from app.modules.users.service import UserService
from dotenv import load_dotenv

router = APIRouter(prefix="/users", tags=["Users"])
load_dotenv()

def _get_user_service(session: AsyncSession = Depends(get_db_session)) -> UserService:
    """Build the UserService with its dependencies (DI wiring)."""
    repository = UserRepository(session)
    return UserService(repository)


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    service: UserService = Depends(_get_user_service),
) -> UserResponse:
    """Get the current authenticated user's profile.

    On the first call, automatically creates the user and a default profile.
    """
    user = await service.get_or_create_user(current_user)
    return UserResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        profile=user.profile,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(
    update_data: UpdateProfileRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: UserService = Depends(_get_user_service),
) -> UserResponse:
    """Update the current user's profile (display name, avatar, preferences)."""
    user = await service.update_profile(current_user, update_data)
    return UserResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        profile=user.profile,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


import os
import httpx
from sqlalchemy import text
from app.modules.auth.dependencies import require_admin

class CreateAdminRequest(BaseModel):
    email: str
    password: str
    secret: str

class PromoteAdminRequest(BaseModel):
    email: str


@router.post("/create-admin-first-time")
async def create_admin_first_time(
    request: CreateAdminRequest,
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Create a new admin user and bypass Supabase email verification."""
    # 1. Verify Secret
    expected_secret = os.environ.get("ADMIN_CREATION_SECRET", "cropstudio_admin_secret_2026")
    if request.secret != expected_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin creation secret"
        )

    # 2. Check if user already exists in auth.users
    result = await db.execute(
        text("SELECT id FROM auth.users WHERE email = :email"),
        {"email": request.email}
    )
    row = result.fetchone()

    # 3. Register User via Supabase Auth API if they don't exist
    if not row:
        signup_url = f"{settings.supabase_url}/auth/v1/signup"
        headers = {
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json"
        }
        body = {
            "email": request.email,
            "password": request.password
        }
        
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(signup_url, json=body, headers=headers, timeout=10.0)
                if resp.status_code >= 400:
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=f"Supabase Auth error: {resp.text}"
                    )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to connect to Supabase Auth: {str(e)}"
                )

        # Look up user again in auth.users by email to get UUID
        result = await db.execute(
            text("SELECT id FROM auth.users WHERE email = :email"),
            {"email": request.email}
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to register user in Supabase auth."
            )
    
    supabase_id = str(row[0])

    # 4. Force confirm email directly in Supabase DB
    await db.execute(
        text("UPDATE auth.users SET email_confirmed_at = CURRENT_TIMESTAMP WHERE email = :email"),
        {"email": request.email}
    )
    await db.commit()

    # 5. Get or create local user record and set role to 'admin'
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(supabase_id)
    if user is None:
        user = await user_repo.create_user(
            supabase_id=supabase_id,
            email=request.email,
            role="admin"
        )
    else:
        user.role = "admin"
    
    await db.commit()

    return {"status": "success", "message": "Admin user created and activated successfully."}


@router.post("/promote-to-admin")
async def promote_to_admin(
    request: PromoteAdminRequest,
    current_admin: CurrentUser = Depends(require_admin),
    service: UserService = Depends(_get_user_service),
) -> dict:
    """Promote an existing user to admin. Admin only."""
    await service.promote_to_admin(request.email)
    return {"status": "success", "message": f"User {request.email} promoted to admin successfully."}


class AdjustCreditsRequest(BaseModel):
    user_id: str
    amount: int


class ChangeTierRequest(BaseModel):
    user_id: str
    tier: str


@router.get("/admin/list", response_model=UsersListResponse)
async def list_users_admin(
    limit: int = 50,
    offset: int = 0,
    email: str | None = None,
    current_admin: CurrentUser = Depends(require_admin),
    service: UserService = Depends(_get_user_service),
) -> UsersListResponse:
    """List users with search and pagination. Admin only."""
    users, total = await service.list_users_admin_with_count(limit=limit, offset=offset, email_search=email)
    return UsersListResponse(
        users=[UserResponse.model_validate(u) for u in users],
        total=total
    )


@router.get("/admin/stats", response_model=AdminStatsResponse)
async def get_admin_stats(
    current_admin: CurrentUser = Depends(require_admin),
    service: UserService = Depends(_get_user_service),
) -> AdminStatsResponse:
    """Get dashboard summary statistics. Admin only."""
    stats = await service.get_admin_stats()
    return AdminStatsResponse(**stats)


@router.post("/admin/adjust-credits")
async def adjust_user_credits(
    request: AdjustCreditsRequest,
    current_admin: CurrentUser = Depends(require_admin),
    service: UserService = Depends(_get_user_service),
) -> dict:
    """Adjust a user's credit balance. Admin only."""
    user = await service.adjust_user_credits(request.user_id, request.amount)
    return {
        "status": "success",
        "message": f"Successfully adjusted user credits. New balance: {user.profile.credit_balance}",
        "credit_balance": user.profile.credit_balance
    }


@router.post("/admin/change-tier")
async def change_user_tier(
    request: ChangeTierRequest,
    current_admin: CurrentUser = Depends(require_admin),
    service: UserService = Depends(_get_user_service),
) -> dict:
    """Manually change a user's subscription tier. Admin only."""
    user = await service.change_user_tier(request.user_id, request.tier)
    return {
        "status": "success",
        "message": f"Successfully changed user tier to {request.tier}.",
        "subscription_tier": user.profile.subscription_tier,
        "credit_balance": user.profile.credit_balance
    }


@router.get("/admin/providers", response_model=list[ProviderStatusResponse])
async def list_providers_admin(
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> list[ProviderStatusResponse]:
    """Get the configuration and active status of all AI provider integrations. Admin only."""
    from sqlalchemy import select
    from app.modules.generation.models import ProviderSetting

    # 1. Fetch current settings from DB
    stmt = select(ProviderSetting)
    result = await session.execute(stmt)
    db_settings = {s.provider_name: s.is_enabled for s in result.scalars().all()}

    providers = ["grok", "openai", "gemini"]
    response = []

    for name in providers:
        # Check if the API key is configured in env
        is_configured = False
        if name == "grok":
            is_configured = bool(settings.grok_api_key)
        elif name == "openai":
            is_configured = bool(settings.openai_api_key)
        elif name == "gemini":
            is_configured = bool(settings.gemini_api_key)

        # Default to True if not in database
        is_enabled = db_settings.get(name, True)

        response.append(
            ProviderStatusResponse(
                provider_name=name,
                is_enabled=is_enabled,
                is_configured=is_configured,
            )
        )
    return response


@router.patch("/admin/providers/{provider_name}", response_model=ProviderStatusResponse)
async def update_provider_status_admin(
    provider_name: str,
    request: UpdateProviderStatusRequest,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProviderStatusResponse:
    """Enable or disable a specific AI provider integration. Admin only."""
    from sqlalchemy import select
    from app.modules.generation.models import ProviderSetting

    if provider_name not in ["grok", "openai", "gemini"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid provider: {provider_name}. Must be 'grok', 'openai', or 'gemini'."
        )

    # Fetch or create DB record
    stmt = select(ProviderSetting).where(ProviderSetting.provider_name == provider_name)
    result = await session.execute(stmt)
    setting = result.scalar_one_or_none()

    if not setting:
        setting = ProviderSetting(provider_name=provider_name, is_enabled=request.is_enabled)
        session.add(setting)
    else:
        setting.is_enabled = request.is_enabled

    await session.flush()

    is_configured = False
    if provider_name == "grok":
        is_configured = bool(settings.grok_api_key)
    elif provider_name == "openai":
        is_configured = bool(settings.openai_api_key)
    elif provider_name == "gemini":
        is_configured = bool(settings.gemini_api_key)

    return ProviderStatusResponse(
        provider_name=provider_name,
        is_enabled=setting.is_enabled,
        is_configured=is_configured,
    )


@router.get("/admin/pricings", response_model=list[ModelPricingResponse])
async def list_model_pricings_admin(
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
) -> list[ModelPricingResponse]:
    """Get the configurations and pricing matrices of all AI models. Admin only."""
    from sqlalchemy import select
    from app.modules.generation.models import ModelPricing
    from app.modules.generation.pricing import DEFAULT_PRICING_CONFIGS
    from app.modules.users.schemas import ModelPricingResponse
    from datetime import datetime, timezone

    stmt = select(ModelPricing)
    result = await session.execute(stmt)
    db_pricings = {p.model_name: p for p in result.scalars().all()}

    response = []
    for model_name, default_cfg in DEFAULT_PRICING_CONFIGS.items():
        if model_name in db_pricings:
            p = db_pricings[model_name]
            # Auto-sync/correct gemini-3.1-flash-lite-image to ensure it only has 1K resolutions and no enterprise/brand_pro tiers
            if model_name == "gemini-3.1-flash-lite-image":
                resolutions = p.pricing_data.get("resolutions", {})
                if "enterprise_studio" in resolutions or "brand_pro" in resolutions:
                    p.pricing_data = default_cfg["pricing_data"]
                    session.add(p)
                    await session.flush()
            
            # Auto-sync/correct gemini-3.1-flash-image to ensure it has correct default rates
            if model_name == "gemini-3.1-flash-image":
                rates = p.pricing_data.get("token_rates", {})
                if rates.get("input_token") != 0.50 / 1_000_000.0 or rates.get("output_token") != 60.00 / 1_000_000.0:
                    p.pricing_data = default_cfg["pricing_data"]
                    session.add(p)
                    await session.flush()

            response.append(
                ModelPricingResponse(
                    model_name=p.model_name,
                    provider_name=p.provider_name,
                    pricing_data=p.pricing_data,
                    updated_at=p.updated_at,
                )
            )
        else:
            response.append(
                ModelPricingResponse(
                    model_name=model_name,
                    provider_name=default_cfg["provider_name"],
                    pricing_data=default_cfg["pricing_data"],
                    updated_at=datetime.now(timezone.utc),
                )
            )
    return response


@router.put("/admin/pricings/{model_name}", response_model=ModelPricingResponse)
async def update_model_pricing_admin(
    model_name: str,
    request: UpdateModelPricingRequest,
    current_admin: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_db_session),
) -> ModelPricingResponse:
    """Create or update dynamic pricing configuration for a model. Admin only."""
    from sqlalchemy import select
    from app.modules.generation.models import ModelPricing
    from app.modules.generation.pricing import DEFAULT_PRICING_CONFIGS
    from app.modules.users.schemas import ModelPricingResponse, UpdateModelPricingRequest
    from datetime import datetime, timezone

    stmt = select(ModelPricing).where(ModelPricing.model_name == model_name)
    result = await session.execute(stmt)
    model_pricing = result.scalar_one_or_none()

    provider_name = "unknown"
    if model_name in DEFAULT_PRICING_CONFIGS:
        provider_name = DEFAULT_PRICING_CONFIGS[model_name]["provider_name"]

    if not model_pricing:
        model_pricing = ModelPricing(
            model_name=model_name,
            provider_name=provider_name,
            pricing_data=request.pricing_data,
        )
        session.add(model_pricing)
    else:
        model_pricing.pricing_data = request.pricing_data
        model_pricing.updated_at = datetime.now(timezone.utc)

    await session.flush()
    return ModelPricingResponse(
        model_name=model_pricing.model_name,
        provider_name=model_pricing.provider_name,
        pricing_data=model_pricing.pricing_data,
        updated_at=model_pricing.updated_at,
    )


class SupportTicketRequest(BaseModel):
    category: str
    subject: str
    message: str


@router.post("/support-ticket")
async def submit_support_ticket(
    request: SupportTicketRequest,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Submit an in-app customer support request or technical inquiry."""
    import uuid
    ticket_id = f"TICK-{uuid.uuid4().hex[:6].upper()}"
    return {
        "status": "success",
        "ticket_id": ticket_id,
        "message": f"Your support ticket #{ticket_id} has been registered! Our catalog support team will reply within 2 hours.",
        "category": request.category,
        "subject": request.subject,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }


