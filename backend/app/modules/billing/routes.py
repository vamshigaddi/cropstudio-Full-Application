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

from app.modules.billing.models import PlanPricing, CreditPackPricing
from sqlalchemy import select

router = APIRouter(prefix="/billing", tags=["Billing"])


# ─── Plan definitions (fallback canonical defaults) ───
PLAN_CONFIG: dict[str, dict] = {
    "creator_lite": {
        "display_name": "Starter",
        "price_inr": 699,
        "price_usd": 12,
        "credits": 300,
        "monthly_quota": 30,
    },
    "brand_pro": {
        "display_name": "Pro",
        "price_inr": 1999,
        "price_usd": 29,
        "credits": 1000,
        "monthly_quota": 100,
    },
    "enterprise_studio": {
        "display_name": "Business",
        "price_inr": 5999,
        "price_usd": 79,
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
        "price_usd": 5,
        "title": "Quick Pack",
        "badge": "Starter",
        "features": ["10 AI Studio Images", "Lifetime Validity", "Instant Activation"]
    },
    {
        "id": "pack_300",
        "credits": 300,
        "images": 30,
        "price_inr": 799,
        "price_usd": 12,
        "title": "Standard Pack",
        "badge": "Value",
        "features": ["30 AI Studio Images", "Lifetime Validity", "Instant Activation"]
    },
    {
        "id": "pack_600",
        "credits": 600,
        "images": 60,
        "price_inr": 1499,
        "price_usd": 22,
        "title": "Studio Pack",
        "badge": "Most Popular",
        "features": ["60 AI Studio Images", "Lifetime Validity", "Priority Processing"]
    },
    {
        "id": "pack_1500",
        "credits": 1500,
        "images": 150,
        "price_inr": 3499,
        "price_usd": 49,
        "title": "Mega Pack",
        "badge": "Best Value",
        "features": ["150 AI Studio Images", "Lifetime Validity", "VIP Priority Processing"]
    },
]


async def ensure_default_pricings_seeded(db: AsyncSession) -> None:
    """Ensure database has default plan and credit pack pricing rows."""
    # 1. Plans
    for plan_id, config in PLAN_CONFIG.items():
        stmt = select(PlanPricing).where(PlanPricing.id == plan_id)
        res = await db.execute(stmt)
        if not res.scalars().first():
            db.add(PlanPricing(
                id=plan_id,
                display_name=config["display_name"],
                price_inr=config["price_inr"],
                price_usd=config.get("price_usd", 12),
                credits=config["credits"],
                monthly_quota=config["monthly_quota"],
                is_active=True
            ))

    # 2. Credit Packs
    for pack in CREDIT_PACKS:
        stmt = select(CreditPackPricing).where(CreditPackPricing.id == pack["id"])
        res = await db.execute(stmt)
        if not res.scalars().first():
            db.add(CreditPackPricing(
                id=pack["id"],
                title=pack["title"],
                credits=pack["credits"],
                images=pack["images"],
                price_inr=pack["price_inr"],
                price_usd=pack.get("price_usd", 5),
                badge=pack.get("badge"),
                is_active=True
            ))

    await db.commit()


class OrderRequest(BaseModel):
    """Request payload to create a new checkout order."""

    credits: int = Field(..., ge=1, le=10000, description="Number of credits to purchase")
    currency: str = Field(default="INR", description="Currency code: INR or USD")


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
    currency: str = Field(default="INR", description="Currency paid in")


class VerifyResponse(BaseModel):
    """Response payload upon successful verification."""

    status: str
    credit_balance: int


class PlanPricingAdminUpdate(BaseModel):
    price_inr: int = Field(..., ge=0)
    price_usd: int = Field(..., ge=0)
    credits: int = Field(..., ge=0)
    monthly_quota: int = Field(..., ge=0)
    is_active: bool = True


class PackPricingAdminUpdate(BaseModel):
    price_inr: int = Field(..., ge=0)
    price_usd: int = Field(..., ge=0)
    credits: int = Field(..., ge=0)
    images: int = Field(..., ge=0)
    is_active: bool = True


def _get_razorpay_client(settings: Settings = Depends(get_settings)) -> RazorpayClient:
    """Build the Razorpay client (DI wiring)."""
    return RazorpayClient(settings)


@router.get("/plans")
async def get_public_plans(
    currency: str = "INR",
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Get active subscription plans and credit packs with dynamic pricing for requested currency."""
    await ensure_default_pricings_seeded(db)
    curr = currency.upper()

    # Query plans
    stmt_plans = select(PlanPricing).where(PlanPricing.is_active == True)
    res_plans = await db.execute(stmt_plans)
    db_plans = res_plans.scalars().all()

    # Query packs
    stmt_packs = select(CreditPackPricing).where(CreditPackPricing.is_active == True)
    res_packs = await db.execute(stmt_packs)
    db_packs = res_packs.scalars().all()

    currency_symbol = "₹" if curr == "INR" else "$"

    formatted_plans = {}
    for p in db_plans:
        price = p.price_inr if curr == "INR" else p.price_usd
        formatted_plans[p.id] = {
            "id": p.id,
            "display_name": p.display_name,
            "price": price,
            "price_inr": p.price_inr,
            "price_usd": p.price_usd,
            "currency": curr,
            "currency_symbol": currency_symbol,
            "credits": p.credits,
            "monthly_quota": p.monthly_quota,
        }

    formatted_packs = []
    for pk in db_packs:
        price = pk.price_inr if curr == "INR" else pk.price_usd
        formatted_packs.append({
            "id": pk.id,
            "title": pk.title,
            "credits": pk.credits,
            "images": pk.images,
            "price": price,
            "price_inr": pk.price_inr,
            "price_usd": pk.price_usd,
            "currency": curr,
            "currency_symbol": currency_symbol,
            "badge": pk.badge,
            "features": [f"{pk.images} AI Studio Images", "Lifetime Validity", "Instant Activation"]
        })

    return {
        "currency": curr,
        "currency_symbol": currency_symbol,
        "plans": formatted_plans,
        "credit_packs": formatted_packs,
    }


@router.get("/admin/plans")
async def get_admin_plans(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Admin endpoint: Get all plans and credit packs with both INR and USD pricing."""
    await ensure_default_pricings_seeded(db)
    stmt_plans = select(PlanPricing)
    res_plans = await db.execute(stmt_plans)
    plans = res_plans.scalars().all()

    stmt_packs = select(CreditPackPricing)
    res_packs = await db.execute(stmt_packs)
    packs = res_packs.scalars().all()

    return {
        "plans": [
            {
                "id": p.id,
                "display_name": p.display_name,
                "price_inr": p.price_inr,
                "price_usd": p.price_usd,
                "credits": p.credits,
                "monthly_quota": p.monthly_quota,
                "is_active": p.is_active,
            }
            for p in plans
        ],
        "credit_packs": [
            {
                "id": pk.id,
                "title": pk.title,
                "credits": pk.credits,
                "images": pk.images,
                "price_inr": pk.price_inr,
                "price_usd": pk.price_usd,
                "badge": pk.badge,
                "is_active": pk.is_active,
            }
            for pk in packs
        ],
    }


@router.put("/admin/plans/{plan_id}")
async def update_admin_plan(
    plan_id: str,
    payload: PlanPricingAdminUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Admin endpoint: Update subscription plan pricing and limits in real-time."""
    await ensure_default_pricings_seeded(db)
    stmt = select(PlanPricing).where(PlanPricing.id == plan_id)
    res = await db.execute(stmt)
    plan = res.scalars().first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    plan.price_inr = payload.price_inr
    plan.price_usd = payload.price_usd
    plan.credits = payload.credits
    plan.monthly_quota = payload.monthly_quota
    plan.is_active = payload.is_active
    await db.commit()

    return {"status": "success", "message": f"Plan {plan_id} updated successfully"}


@router.put("/admin/packs/{pack_id}")
async def update_admin_pack(
    pack_id: str,
    payload: PackPricingAdminUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Admin endpoint: Update credit pack pricing in real-time."""
    await ensure_default_pricings_seeded(db)
    stmt = select(CreditPackPricing).where(CreditPackPricing.id == pack_id)
    res = await db.execute(stmt)
    pack = res.scalars().first()
    if not pack:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credit pack not found")

    pack.price_inr = payload.price_inr
    pack.price_usd = payload.price_usd
    pack.credits = payload.credits
    pack.images = payload.images
    pack.is_active = payload.is_active
    await db.commit()

    return {"status": "success", "message": f"Credit pack {pack_id} updated successfully"}


@router.post("/razorpay/order", response_model=OrderResponse)
async def create_razorpay_order(
    request: OrderRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    razorpay_client: RazorpayClient = Depends(_get_razorpay_client),
) -> OrderResponse:
    """Create a Razorpay order to buy credits with dynamic DB pricing & multi-currency."""
    await ensure_default_pricings_seeded(db)
    user_repo = UserRepository(db)
    user = await user_repo.get_by_supabase_id(current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    curr = request.currency.upper()
    
    # Query database pack pricing
    stmt = select(CreditPackPricing).where(CreditPackPricing.credits == request.credits)
    res = await db.execute(stmt)
    pack = res.scalars().first()

    if pack:
        price = pack.price_inr if curr == "INR" else pack.price_usd
    else:
        # Fallback proportional pricing
        if curr == "INR":
            price = max(99, int(round(request.credits * 2.50)))
        else:
            price = max(3, int(round(request.credits * 0.04)))

    # Amount in sub-units (paise for INR, cents for USD)
    amount_in_subunits = price * 100
    receipt = f"rcpt_{user.id.hex[:24]}"

    order_data = await razorpay_client.create_order(amount_in_subunits, receipt, currency=curr)

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


class SubscriptionOrderRequest(BaseModel):
    """Request payload to create a Razorpay order for a subscription plan."""

    tier: str = Field(..., description="Plan tier to subscribe to")
    currency: str = Field(default="INR", description="Currency code: INR or USD")


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
    currency: str = Field(default="INR", description="Currency paid in")


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
    """Create a Razorpay order for a subscription plan purchase (supporting dynamic DB pricing, INR/USD multi-currency, and proration)."""
    await ensure_default_pricings_seeded(db)
    
    # Query database plan pricing
    stmt = select(PlanPricing).where(PlanPricing.id == request.tier)
    res = await db.execute(stmt)
    db_plan = res.scalars().first()

    if not db_plan or not db_plan.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive plan tier.",
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

    curr = request.currency.upper()
    target_price = db_plan.price_inr if curr == "INR" else db_plan.price_usd
    now_utc = datetime.now(timezone.utc)

    # 1. New Subscription (from free plan or if previous plan has expired)
    if current_tier == "free" or not user.profile.subscription_period_end or user.profile.subscription_period_end <= now_utc:
        amount_in_subunits = target_price * 100
        receipt = f"sub_new_{request.tier[:8]}_{user.id.hex[:16]}"
        order_data = await razorpay_client.create_order(amount_in_subunits, receipt, currency=curr)

        return SubscriptionOrderResponse(
            order_id=order_data["id"],
            amount=order_data["amount"],
            currency=order_data["currency"],
            tier=request.tier,
            credits=db_plan.credits,
            display_name=db_plan.display_name,
            key_id=razorpay_client.key_id,
            prorated=False,
            status="created",
        )

    # 2. Existing active paid subscription
    stmt_curr = select(PlanPricing).where(PlanPricing.id == current_tier)
    res_curr = await db.execute(stmt_curr)
    db_curr_plan = res_curr.scalars().first()
    price_current = (db_curr_plan.price_inr if curr == "INR" else db_curr_plan.price_usd) if db_curr_plan else 0
    price_target = target_price

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

        # Prorated calculation
        diff_price = price_target - price_current
        prorated_charge = diff_price * ratio
        amount_in_subunits = max(100, round(prorated_charge * 100))

        original_amount_subunits = price_target * 100
        savings_subunits = original_amount_subunits - amount_in_subunits

        receipt = f"sub_upg_{request.tier[:8]}_{user.id.hex[:16]}"
        order_data = await razorpay_client.create_order(amount_in_subunits, receipt, currency=curr)

        return SubscriptionOrderResponse(
            order_id=order_data["id"],
            amount=order_data["amount"],
            currency=order_data["currency"],
            tier=request.tier,
            credits=db_plan.credits,
            display_name=db_plan.display_name,
            key_id=razorpay_client.key_id,
            prorated=True,
            original_amount=original_amount_subunits,
            proration_savings=savings_subunits,
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
    await ensure_default_pricings_seeded(db)
    stmt = select(PlanPricing).where(PlanPricing.id == request.tier)
    res = await db.execute(stmt)
    db_plan = res.scalars().first()

    if not db_plan:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid subscription plan tier.",
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

    now_utc = datetime.now(timezone.utc)
    curr = request.currency.upper()
    paid_amount = db_plan.price_inr if curr == "INR" else db_plan.price_usd

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

    new_tx = {
        "id": tx_id,
        "invoice_id": inv_id,
        "type": "subscription",
        "description": f"{db_plan.display_name} Monthly Plan",
        "amount_inr": paid_amount if curr == "INR" else int(paid_amount * 84),
        "amount": paid_amount,
        "currency": curr,
        "credits_granted": db_plan.credits,
        "date": now_utc.strftime("%b %d, %Y"),
        "timestamp": now_utc.isoformat(),
        "status": "Paid",
        "payment_id": request.razorpay_payment_id,
        "payment_method": f"Razorpay ({curr})",
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
    user.profile.credit_balance = db_plan.credits
    user.profile.monthly_image_quota = db_plan.monthly_quota
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




