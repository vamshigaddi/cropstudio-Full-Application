from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.core.exceptions import ValidationError
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import CurrentUser
from app.modules.billing.razorpay_client import RazorpayClient
from app.modules.users.repository import UserRepository

router = APIRouter(prefix="/billing", tags=["Billing"])


# ─── Plan definitions (canonical source of truth) ───
PLAN_CONFIG: dict[str, dict] = {
    "creator_lite": {
        "display_name": "Starter",
        "price_inr": 699,
        "credits": 300,
        "monthly_quota": 30,
    },
    "brand_pro": {
        "display_name": "Pro",
        "price_inr": 1999,
        "credits": 1000,
        "monthly_quota": 100,
    },
    "enterprise_studio": {
        "display_name": "Business",
        "price_inr": 5999,
        "credits": 3000,
        "monthly_quota": 300,
    },
}


CREDIT_PACKS: list[dict] = [
    {
        "id": "pack_100",
        "credits": 100,
        "images": 10,
        "price_inr": 299,
        "title": "Quick Pack",
        "badge": "Starter",
        "features": ["10 AI Studio Images", "Lifetime Validity", "Instant Activation"]
    },
    {
        "id": "pack_300",
        "credits": 300,
        "images": 30,
        "price_inr": 799,
        "title": "Standard Pack",
        "badge": "Value",
        "features": ["30 AI Studio Images", "Lifetime Validity", "Instant Activation"]
    },
    {
        "id": "pack_600",
        "credits": 600,
        "images": 60,
        "price_inr": 1499,
        "title": "Studio Pack",
        "badge": "Most Popular",
        "features": ["60 AI Studio Images", "Lifetime Validity", "Priority Processing"]
    },
    {
        "id": "pack_1500",
        "credits": 1500,
        "images": 150,
        "price_inr": 3499,
        "title": "Mega Pack",
        "badge": "Best Value",
        "features": ["150 AI Studio Images", "Lifetime Validity", "VIP Priority Processing"]
    },
]


class OrderRequest(BaseModel):
    """Request payload to create a new checkout order."""

    credits: int = Field(..., ge=1, le=10000, description="Number of credits to purchase")


class OrderResponse(BaseModel):
    """Response payload containing created order details."""

    order_id: str
    amount: int
    currency: str
    credits: int
    key_id: str | None = None


class VerifyRequest(BaseModel):
    """Request payload to verify signature and credit the account."""

    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    credits: int = Field(..., ge=1, description="Number of credits purchased")


class VerifyResponse(BaseModel):
    """Response payload upon successful verification."""

    status: str
    credit_balance: int


def _get_razorpay_client(settings: Settings = Depends(get_settings)) -> RazorpayClient:
    """Build the Razorpay client (DI wiring)."""
    return RazorpayClient(settings)


CREDIT_PACK_PRICING: dict[int, int] = {
    100: 299,
    300: 799,
    600: 1499,
    1500: 3499,
}


@router.post("/razorpay/order", response_model=OrderResponse)
async def create_razorpay_order(
    request: OrderRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> OrderResponse:
    """Create a Razorpay order to buy credits (tiered add-on pricing)."""
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Compute price in INR and convert to paise
    if request.credits in CREDIT_PACK_PRICING:
        price_in_inr = CREDIT_PACK_PRICING[request.credits]
    else:
        # Default ~2.5 INR per credit
        price_in_inr = max(99, int(round(request.credits * 2.50)))

    amount_in_paise = price_in_inr * 100
    receipt = f"rcpt_{user.id.hex[:24]}"

    order_data = await razorpay_client.create_order(amount_in_paise, receipt)

    return OrderResponse(
        order_id=order_data["id"],
        amount=order_data["amount"],
        currency=order_data["currency"],
        credits=request.credits,
        key_id=razorpay_client.key_id,
    )


@router.post("/razorpay/verify", response_model=VerifyResponse)
async def verify_razorpay_payment(
    request: VerifyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> VerifyResponse:
    """Verify Razorpay payment signature, record transaction, and add credits to the profile."""
    # Allow mock signatures for simulated / test payments
    if not request.razorpay_order_id.startswith("order_mock_") and not request.razorpay_signature.startswith("mock_"):
        is_valid = razorpay_client.verify_payment_signature(
            order_id=request.razorpay_order_id,
            payment_id=request.razorpay_payment_id,
            signature=request.razorpay_signature,
        )
        if not is_valid:
            raise ValidationError(message="Invalid Razorpay signature")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    # Compute purchase price
    price_in_inr = CREDIT_PACK_PRICING.get(request.credits, max(99, int(round(request.credits * 2.50))))
    now_utc = datetime.now(timezone.utc)

    # Record persistent transaction in profile preferences
    import uuid
    prefs = dict(user.profile.preferences) if user.profile.preferences else {}
    transactions = list(prefs.get("transactions", []))

    # Idempotency guard: prevent duplicate credit additions if same payment_id submitted twice
    if any(t.get("payment_id") == request.razorpay_payment_id for t in transactions):
        return VerifyResponse(
            status="success",
            credit_balance=user.profile.credit_balance,
        )

    tx_id = f"TXN-{uuid.uuid4().hex[:8].upper()}"
    inv_id = f"INV-{user.id.hex[:6].upper()}-{len(transactions)+1:03d}"

    new_tx = {
        "id": tx_id,
        "invoice_id": inv_id,
        "type": "topup",
        "description": f"Add-On Top-Up ({request.credits} Credits)",
        "amount_inr": price_in_inr,
        "credits_granted": request.credits,
        "date": now_utc.strftime("%b %d, %Y"),
        "timestamp": now_utc.isoformat(),
        "status": "Paid",
        "payment_id": request.razorpay_payment_id,
        "payment_method": "Razorpay (UPI / NetBanking / Cards)",
    }
    transactions.insert(0, new_tx)
    prefs["transactions"] = transactions
    prefs["total_topup_spent_inr"] = prefs.get("total_topup_spent_inr", 0) + price_in_inr

    user.profile.preferences = prefs
    user.profile.credit_balance += request.credits
    await db.commit()

    return VerifyResponse(
        status="success",
        credit_balance=user.profile.credit_balance,
    )


# ─── Subscription Plan Payment Schemas ───

class SubscriptionOrderRequest(BaseModel):
    """Request payload to create a Razorpay order for a subscription plan."""

    tier: str = Field(..., description="Plan tier to subscribe to")


class SubscriptionOrderResponse(BaseModel):
    """Order details for a subscription plan payment."""

    order_id: str
    amount: int
    currency: str
    tier: str
    credits: int
    display_name: str
    key_id: str | None = None
    prorated: bool = False
    original_amount: int | None = None
    proration_savings: int | None = None
    days_remaining: float | None = None
    status: str = "created"  # can be "created" or "scheduled"


class SubscriptionVerifyRequest(BaseModel):
    """Verify payment and activate subscription tier."""

    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    tier: str


class SubscriptionVerifyResponse(BaseModel):
    """Result of subscription activation."""

    status: str
    subscription_tier: str
    credit_balance: int
    monthly_image_quota: int


@router.post("/razorpay/order/subscription", response_model=SubscriptionOrderResponse)
async def create_subscription_order(
    request: SubscriptionOrderRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> SubscriptionOrderResponse:
    """Create a Razorpay order for a subscription plan purchase (supporting proration upgrades and scheduled downgrades)."""
    if request.tier not in PLAN_CONFIG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid tier. Must be one of {list(PLAN_CONFIG.keys())}",
        )

    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")

    current_tier = user.profile.subscription_tier
    if current_tier == request.tier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already subscribed to this plan.",
        )

    plan = PLAN_CONFIG[request.tier]
    now_utc = datetime.now(timezone.utc)

    # 1. New Subscription (from free plan or if previous plan has expired)
    if current_tier == "free" or not user.profile.subscription_period_end or user.profile.subscription_period_end <= now_utc:
        amount_in_paise = plan["price_inr"] * 100
        receipt = f"sub_new_{request.tier[:8]}_{user.id.hex[:16]}"
        order_data = await razorpay_client.create_order(amount_in_paise, receipt)

        return SubscriptionOrderResponse(
            order_id=order_data["id"],
            amount=order_data["amount"],
            currency=order_data["currency"],
            tier=request.tier,
            credits=plan["credits"],
            display_name=plan["display_name"],
            key_id=razorpay_client.key_id,
            prorated=False,
            status="created",
        )

    # 2. Existing active paid subscription
    price_current = PLAN_CONFIG[current_tier]["price_inr"]
    price_target = plan["price_inr"]

    # Case A: UPGRADE (target price is higher than current price)
    if price_target > price_current:
        # Check active billing period dates, set default if not initialized
        if not user.profile.subscription_period_start or not user.profile.subscription_period_end:
            user.profile.subscription_period_start = now_utc - timedelta(days=10)
            user.profile.subscription_period_end = now_utc + timedelta(days=20)
            await db.flush()

        total_sec = (user.profile.subscription_period_end - user.profile.subscription_period_start).total_seconds()
        remaining_sec = (user.profile.subscription_period_end - now_utc).total_seconds()

        # Safely clamp inputs
        if total_sec <= 0:
            total_sec = 30 * 86400.0
        if remaining_sec < 0:
            remaining_sec = 0

        ratio = min(1.0, max(0.0, remaining_sec / total_sec))
        days_remaining = round(remaining_sec / 86400.0, 1)

        # Prorated calculation: Charge = (Price_Target - Price_Current) * ratio
        diff_inr = price_target - price_current
        prorated_charge_inr = diff_inr * ratio
        amount_in_paise = max(100, round(prorated_charge_inr * 100))  # Minimum 1 INR (100 paise) for Razorpay

        original_amount_paise = price_target * 100
        savings_paise = original_amount_paise - amount_in_paise

        receipt = f"sub_upg_{request.tier[:8]}_{user.id.hex[:16]}"
        order_data = await razorpay_client.create_order(amount_in_paise, receipt)

        return SubscriptionOrderResponse(
            order_id=order_data["id"],
            amount=order_data["amount"],
            currency=order_data["currency"],
            tier=request.tier,
            credits=plan["credits"],
            display_name=plan["display_name"],
            key_id=razorpay_client.key_id,
            prorated=True,
            original_amount=original_amount_paise,
            proration_savings=savings_paise,
            days_remaining=days_remaining,
            status="created",
        )

    # Case B: DOWNGRADE (target price is lower or equal, e.g. scheduled downgrade)
    else:
        # Schedule the downgrade to activate at the end of the current cycle
        user.profile.pending_downgrade_tier = request.tier
        await db.commit()

        # No Razorpay payment needed for scheduled downgrades
        return SubscriptionOrderResponse(
            order_id="scheduled_downgrade",
            amount=0,
            currency="INR",
            tier=request.tier,
            credits=plan["credits"],
            display_name=plan["display_name"],
            key_id=None,
            prorated=False,
            status="scheduled",
            days_remaining=round((user.profile.subscription_period_end - now_utc).total_seconds() / 86400.0, 1),
        )


@router.post("/razorpay/verify/subscription", response_model=SubscriptionVerifyResponse)
async def verify_subscription_payment(
    request: SubscriptionVerifyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> SubscriptionVerifyResponse:
    """Verify Razorpay payment and atomically activate/upgrade the subscription tier."""
    if request.tier not in PLAN_CONFIG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid tier. Must be one of {list(PLAN_CONFIG.keys())}",
        )

    # Allow mock signatures for simulated payments
    if not request.razorpay_order_id.startswith("order_mock_"):
        is_valid = razorpay_client.verify_payment_signature(
            order_id=request.razorpay_order_id,
            payment_id=request.razorpay_payment_id,
            signature=request.razorpay_signature,
        )
        if not is_valid:
            raise ValidationError(message="Invalid Razorpay payment signature")

    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    plan = PLAN_CONFIG[request.tier]
    now_utc = datetime.now(timezone.utc)

    # Idempotency guard: prevent duplicate charges / double execution
    import uuid
    prefs = dict(user.profile.preferences) if user.profile.preferences else {}
    transactions = list(prefs.get("transactions", []))
    if any(t.get("payment_id") == request.razorpay_payment_id for t in transactions):
        return SubscriptionVerifyResponse(
            status="success",
            subscription_tier=user.profile.subscription_tier,
            credit_balance=user.profile.credit_balance,
            monthly_image_quota=user.profile.monthly_image_quota,
        )

    # Record subscription purchase transaction for invoices & ledger
    tx_id = f"TXN-{uuid.uuid4().hex[:8].upper()}"
    inv_id = f"INV-{user.id.hex[:6].upper()}-{len(transactions)+1:03d}"
    price_inr = plan["price_inr"]

    new_tx = {
        "id": tx_id,
        "invoice_id": inv_id,
        "type": "subscription",
        "description": f"{plan['display_name']} Monthly Plan",
        "amount_inr": price_inr,
        "credits_granted": plan["credits"],
        "date": now_utc.strftime("%b %d, %Y"),
        "timestamp": now_utc.isoformat(),
        "status": "Paid",
        "payment_id": request.razorpay_payment_id,
        "payment_method": "Razorpay (UPI / NetBanking / Cards)",
    }
    transactions.insert(0, new_tx)
    prefs["transactions"] = transactions
    user.profile.preferences = prefs

    # If new subscription or previous one expired, start a new 30-day billing cycle
    is_new_cycle = (
        user.profile.subscription_tier == "free"
        or not user.profile.subscription_period_end
        or user.profile.subscription_period_end <= now_utc
    )

    if is_new_cycle:
        user.profile.subscription_period_start = now_utc
        user.profile.subscription_period_end = now_utc + timedelta(days=30)

    # Apply changes
    user.profile.subscription_tier = request.tier
    user.profile.credit_balance = plan["credits"]
    user.profile.monthly_image_quota = plan["monthly_quota"]
    user.profile.pending_downgrade_tier = None  # Clear any scheduled downgrades

    await db.commit()

    return SubscriptionVerifyResponse(
        status="success",
        subscription_tier=user.profile.subscription_tier,
        credit_balance=user.profile.credit_balance,
        monthly_image_quota=user.profile.monthly_image_quota,
    )



# ─── Admin / Dev Direct Subscription Override ───

class SubscriptionRequest(BaseModel):
    """Request payload to change subscription tier (admin/dev use only)."""

    tier: str = Field(..., description="Plan tier to select")


class SubscriptionResponse(BaseModel):
    """Response payload upon successful subscription change."""

    status: str
    subscription_tier: str
    credit_balance: int


@router.post("/subscription", response_model=SubscriptionResponse)
async def update_subscription(
    request: SubscriptionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SubscriptionResponse:
    """Directly update subscription tier (dev/admin override, no payment)."""
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    valid_tiers = ["free", *PLAN_CONFIG.keys()]
    if request.tier not in valid_tiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid tier. Must be one of {valid_tiers}",
        )

    user.profile.subscription_tier = request.tier
    if request.tier in PLAN_CONFIG:
        plan = PLAN_CONFIG[request.tier]
        user.profile.credit_balance = plan["credits"]
        user.profile.monthly_image_quota = plan["monthly_quota"]
    else:
        user.profile.credit_balance = 10
        user.profile.monthly_image_quota = 50

    await db.commit()

    return SubscriptionResponse(
        status="success",
        subscription_tier=user.profile.subscription_tier,
        credit_balance=user.profile.credit_balance,
    )


class SimulateTimeRequest(BaseModel):
    days: int = Field(..., description="Number of days to shift backward")


class SimulateTimeResponse(BaseModel):
    status: str
    subscription_period_start: datetime | None = None
    subscription_period_end: datetime | None = None


@router.post("/simulate-time", response_model=SimulateTimeResponse)
async def simulate_time(
    request: SimulateTimeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SimulateTimeResponse:
    """Developer helper: shift subscription billing cycle backward to test proration and downgrades."""
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    if user.profile.subscription_period_start:
        user.profile.subscription_period_start -= timedelta(days=request.days)
    if user.profile.subscription_period_end:
        user.profile.subscription_period_end -= timedelta(days=request.days)

    await db.commit()

    return SimulateTimeResponse(
        status="success",
        subscription_period_start=user.profile.subscription_period_start,
        subscription_period_end=user.profile.subscription_period_end,
    )


# ─── Regular User Usage & Spend History ───

@router.get("/usage-history")
async def get_usage_history(
    time_range: str = "all",
    modes: str | None = None,
    page: int = 1,
    page_size: int = 10,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return user's billing plan status, credit consumption logs with server-side filtering, and invoice receipts."""
    from sqlalchemy import select, desc, and_
    from app.modules.batches.models import Batch
    from app.modules.jobs.models import Job

    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user or not user.profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    # 1. Build Query with Time Range Filter
    conditions = [Batch.user_id == user.id]
    now_utc = datetime.now(timezone.utc)

    if time_range == "last_7_days":
        conditions.append(Batch.created_at >= now_utc - timedelta(days=7))
    elif time_range == "last_30_days":
        conditions.append(Batch.created_at >= now_utc - timedelta(days=30))
    elif time_range == "this_month":
        start_of_month = now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        conditions.append(Batch.created_at >= start_of_month)

    stmt = select(Batch).where(and_(*conditions)).order_by(desc(Batch.created_at))
    result = await db.execute(stmt)
    batches = result.scalars().all()

    target_modes_set = set(modes.split(",")) if modes and modes != "all" else None

    usage_logs = []
    total_credits_spent = 0
    total_images_processed = 0

    for b in batches:
        # Fetch jobs for this batch
        job_stmt = select(Job).where(Job.batch_id == b.id)
        job_res = await db.execute(job_stmt)
        jobs = job_res.scalars().all()

        batch_modes = list({j.generation_mode for j in jobs})
        
        # Filter by modes if specified
        if target_modes_set and not any(m in target_modes_set for m in batch_modes):
            continue

        images_count = len(jobs)
        paid_modes_count = sum(1 for m in batch_modes if m not in ("background_removal", "white_background"))
        unique_image_ids = len({j.image_id for j in jobs}) or (images_count // (len(batch_modes) or 1))

        batch_credits = unique_image_ids * paid_modes_count * 10
        total_credits_spent += batch_credits
        total_images_processed += images_count

        completed_count = sum(1 for j in jobs if j.status == "completed")
        failed_count = sum(1 for j in jobs if j.status == "failed")

        usage_logs.append({
            "id": str(b.id),
            "name": b.name or "Bulk Generation",
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "status": b.status,
            "modes": batch_modes,
            "images_count": images_count,
            "unique_skus": unique_image_ids,
            "credits_used": batch_credits,
            "completed_jobs": completed_count,
            "failed_jobs": failed_count,
        })

    # Pagination calculation
    total_count = len(usage_logs)
    safe_page_size = max(1, min(100, page_size))
    total_pages = max(1, (total_count + safe_page_size - 1) // safe_page_size)
    safe_page = max(1, min(page, total_pages))
    paginated_logs = usage_logs[(safe_page - 1) * safe_page_size : safe_page * safe_page_size]

    # 2. Invoices / Purchase History
    prefs = user.profile.preferences if user.profile.preferences and isinstance(user.profile.preferences, dict) else {}
    recorded_txs = list(prefs.get("transactions", []))

    invoices = list(recorded_txs)

    # Ensure active paid plan subscription invoice is always present
    plan_key = user.profile.subscription_tier
    plan_info = PLAN_CONFIG.get(plan_key)
    if plan_key != "free" and plan_info and plan_info.get("price_inr", 0) > 0:
        has_sub_invoice = any(tx.get("type") == "subscription" or "Subscription" in tx.get("description", "") for tx in invoices)
        if not has_sub_invoice:
            inv_date = user.profile.subscription_period_start or user.created_at
            sub_inv = {
                "id": f"TXN-SUB-{user.id.hex[:6].upper()}",
                "invoice_id": f"INV-{user.id.hex[:6].upper()}-001",
                "type": "subscription",
                "date": inv_date.strftime("%b %d, %Y") if inv_date else "Recent",
                "timestamp": inv_date.isoformat() if isinstance(inv_date, datetime) else datetime.now(timezone.utc).isoformat(),
                "description": f"{plan_info['display_name']} Plan (Monthly Subscription)",
                "amount_inr": plan_info["price_inr"],
                "credits_granted": plan_info["credits"],
                "status": "Paid",
                "payment_method": "Razorpay (UPI / NetBanking / Cards)",
            }
            # Append subscription invoice so topup is first (most recent)
            invoices.append(sub_inv)

    plan_key = user.profile.subscription_tier
    plan_info = PLAN_CONFIG.get(plan_key, {
        "display_name": "Free Starter" if plan_key == "free" else plan_key.capitalize(),
        "price_inr": 0,
        "credits": user.profile.credit_balance,
        "monthly_quota": user.profile.monthly_image_quota,
    })

    tier_info = {
        "tier": user.profile.subscription_tier,
        "display_name": plan_info["display_name"],
        "price_inr": plan_info.get("price_inr", 0),
        "credit_balance": user.profile.credit_balance,
        "monthly_image_quota": user.profile.monthly_image_quota,
        "subscription_period_start": user.profile.subscription_period_start.isoformat() if user.profile.subscription_period_start else None,
        "subscription_period_end": user.profile.subscription_period_end.isoformat() if user.profile.subscription_period_end else None,
        "pending_downgrade_tier": user.profile.pending_downgrade_tier,
        "total_credits_spent": total_credits_spent,
        "total_images_processed": total_images_processed,
    }

    return {
        "plan": tier_info,
        "usage_logs": paginated_logs,
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_count": total_count,
            "total_pages": total_pages,
            "time_range": time_range,
            "modes": modes or "all",
        },
        "invoices": invoices,
        "available_plans": PLAN_CONFIG,
        "credit_packs": CREDIT_PACKS,
    }


@router.get("/packages")
async def get_billing_packages() -> dict:
    """Get all subscription plans and add-on credit packages dynamically from backend."""
    return {
        "plans": PLAN_CONFIG,
        "credit_packs": CREDIT_PACKS,
    }


# ─── Razorpay Webhooks ───

@router.post("/razorpay/webhook")
async def handle_razorpay_webhook(
    request: Request,
    x_razorpay_signature: str | None = Header(None, alias="X-Razorpay-Signature"),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> dict:
    """Handle incoming Razorpay webhooks asynchronously for resilient subscription and credit payments."""
    import json
    from sqlalchemy import select, String
    from app.modules.users.models import User

    body_bytes = await request.body()
    if x_razorpay_signature and not razorpay_client.verify_webhook_signature(body_bytes, x_razorpay_signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    try:
        event_data = json.loads(body_bytes)
    except Exception:
        return {"status": "ignored", "reason": "invalid_json"}

    event_type = event_data.get("event")
    payload = event_data.get("payload", {})
    payment_entity = payload.get("payment", {}).get("entity", {})
    order_entity = payload.get("order", {}).get("entity", {})

    receipt = payment_entity.get("receipt") or order_entity.get("receipt", "")

    if event_type in ("payment.captured", "order.paid"):
        # 1. Subscription activation or upgrade
        if receipt.startswith("sub_"):
            parts = receipt.split("_")
            if len(parts) >= 3:
                tier_prefix = parts[2]
                target_tier = next((t for t in PLAN_CONFIG if t.startswith(tier_prefix)), None)
                user_hex = parts[-1] if len(parts) >= 4 else ""

                if target_tier and target_tier in PLAN_CONFIG:
                    plan = PLAN_CONFIG[target_tier]
                    stmt = select(User).where(User.id.cast(String).ilike(f"%{user_hex}%"))
                    res = await db.execute(stmt)
                    user = res.scalars().first()
                    if user and user.profile:
                        now_utc = datetime.now(timezone.utc)
                        user.profile.subscription_tier = target_tier
                        user.profile.credit_balance = plan["credits"]
                        user.profile.monthly_image_quota = plan["monthly_quota"]
                        user.profile.subscription_period_start = now_utc
                        user.profile.subscription_period_end = now_utc + timedelta(days=30)
                        await db.commit()

        # 2. Credit top-up
        elif receipt.startswith("rcpt_"):
            user_hex = receipt.replace("rcpt_", "")[:24]
            stmt = select(User).where(User.id.cast(String).ilike(f"%{user_hex}%"))
            res = await db.execute(stmt)
            user = res.scalars().first()
            if user and user.profile:
                amount = payment_entity.get("amount", 0)
                credits_bought = max(1, amount // 3000)
                user.profile.credit_balance += credits_bought
                await db.commit()

    elif event_type in ("refund.processed", "payment.refunded"):
        # Handle refund event: mark transaction status as Refunded
        refund_entity = payload.get("refund", {}).get("entity", {})
        target_payment_id = payment_entity.get("id") or refund_entity.get("payment_id")

        if target_payment_id:
            from app.modules.users.models import User
            stmt = select(User)
            res = await db.execute(stmt)
            users = res.scalars().all()
            for u in users:
                if u.profile and u.profile.preferences:
                    prefs = dict(u.profile.preferences)
                    transactions = list(prefs.get("transactions", []))
                    matched = False
                    for tx in transactions:
                        if tx.get("payment_id") == target_payment_id:
                            tx["status"] = "Refunded"
                            matched = True
                    if matched:
                        prefs["transactions"] = transactions
                        u.profile.preferences = prefs
                        await db.commit()
                        break

    elif event_type == "payment.failed":
        # Log failure attempt in audit
        error_desc = payment_entity.get("error_description") or "Payment was declined"
        user_hex = receipt.split("_")[-1] if "_" in receipt else receipt
        if user_hex:
            stmt = select(User).where(User.id.cast(String).ilike(f"%{user_hex}%"))
            res = await db.execute(stmt)
            user = res.scalars().first()
            if user and user.profile:
                prefs = dict(user.profile.preferences) if user.profile.preferences else {}
                transactions = list(prefs.get("transactions", []))
                failed_tx = {
                    "id": f"TXN-FAIL-{payment_entity.get('id', 'NA')[-6:]}",
                    "invoice_id": "N/A",
                    "type": "failed",
                    "description": f"Failed Payment: {error_desc}",
                    "amount_inr": payment_entity.get("amount", 0) // 100,
                    "credits_granted": 0,
                    "date": datetime.now(timezone.utc).strftime("%b %d, %Y"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "status": "Failed",
                    "payment_id": payment_entity.get("id", "N/A"),
                    "payment_method": "Razorpay",
                }
                transactions.insert(0, failed_tx)
                prefs["transactions"] = transactions[:50]
                user.profile.preferences = prefs
                await db.commit()

    return {"status": "success", "event": event_type}




