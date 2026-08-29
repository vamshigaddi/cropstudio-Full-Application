"""Audit module — API route handlers."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.modules.auth.dependencies import require_admin
from app.modules.auth.schemas import CurrentUser
from app.modules.audit.repository import AuditLogRepository
from app.modules.audit.schemas import AuditLogResponse, CostSummaryResponse
from app.modules.audit.service import AuditLogService

router = APIRouter(prefix="/admin/audit", tags=["Admin Audit"])


def _get_audit_service(session: AsyncSession = Depends(get_db_session)) -> AuditLogService:
    """Build the AuditLogService with its repository dependency."""
    repository = AuditLogRepository(session)
    return AuditLogService(repository)


@router.get("/", response_model=list[AuditLogResponse])
async def list_audit_logs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    actor_id: uuid.UUID | None = Query(None),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    current_admin: CurrentUser = Depends(require_admin),
    service: AuditLogService = Depends(_get_audit_service),
) -> list[AuditLogResponse]:
    """Retrieve a list of system audit logs. Admin only."""
    logs = await service.get_audit_logs(
        limit=limit,
        offset=offset,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
    )
    return [
        AuditLogResponse(
            id=log.id,
            actor_id=log.actor_id,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            action_metadata=log.action_metadata,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log in logs
    ]


@router.get("/costs", response_model=CostSummaryResponse)
async def get_cost_summary(
    current_admin: CurrentUser = Depends(require_admin),
    service: AuditLogService = Depends(_get_audit_service),
) -> CostSummaryResponse:
    """Retrieve the aggregated cost and latency report for AI provider requests. Admin only."""
    summary = await service.get_cost_summary()
    return CostSummaryResponse(**summary)


# ─── Admin Support & Issue Debugger Endpoints ───

@router.get("/issues/failed-jobs")
async def list_failed_jobs(
    limit: int = 50,
    offset: int = 0,
    current_admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """List failed generation jobs with user info and error traces for support debugging. Admin only."""
    from sqlalchemy import select, desc
    from app.modules.jobs.models import Job
    from app.modules.batches.models import Batch
    from app.modules.users.models import User

    stmt = (
        select(Job, Batch, User)
        .join(Batch, Job.batch_id == Batch.id)
        .join(User, Batch.user_id == User.id)
        .where(Job.status == "failed")
        .order_by(desc(Job.created_at))
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.all()

    failed_jobs = []
    for job, batch, user in rows:
        failed_jobs.append({
            "job_id": str(job.id),
            "batch_id": str(batch.id),
            "batch_name": batch.name or "Bulk Run",
            "user_id": str(user.id),
            "user_email": user.email or "Unknown",
            "generation_mode": job.generation_mode,
            "attempts": job.attempts,
            "error_message": job.error_message or "Unknown AI provider error",
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "image_id": str(job.image_id) if job.image_id else None,
        })

    return {"failed_jobs": failed_jobs, "total": len(failed_jobs)}


@router.post("/issues/retry/{job_id}")
async def retry_failed_job(
    job_id: uuid.UUID,
    current_admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Reset a failed job to pending so workers pick it up again. Admin only."""
    from sqlalchemy import select
    from app.modules.jobs.models import Job

    stmt = select(Job).where(Job.id == job_id)
    res = await db.execute(stmt)
    job = res.scalars().first()
    if not job:
        return {"status": "error", "message": "Job not found"}

    job.status = "pending"
    job.attempts = 0
    job.error_message = None
    await db.commit()

    return {"status": "success", "message": f"Job {job_id} re-queued for processing"}


@router.post("/issues/refund/{job_id}")
async def refund_failed_job(
    job_id: uuid.UUID,
    current_admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Refund 10 credits to the user for a failed job. Admin only."""
    from sqlalchemy import select
    from app.modules.jobs.models import Job
    from app.modules.batches.models import Batch
    from app.modules.users.models import User

    stmt = (
        select(Job, Batch, User)
        .join(Batch, Job.batch_id == Batch.id)
        .join(User, Batch.user_id == User.id)
        .where(Job.id == job_id)
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        return {"status": "error", "message": "Job not found"}

    job, batch, user = row
    if user and user.profile:
        user.profile.credit_balance += 10
        job.error_message = f"{job.error_message or ''} [REFUNDED 10 CR BY ADMIN]"
        await db.commit()
        return {
            "status": "success",
            "message": f"Successfully refunded 10 credits to {user.email}. New balance: {user.profile.credit_balance}",
            "credit_balance": user.profile.credit_balance
        }

    return {"status": "error", "message": "User profile not found"}


# ─── Admin Financials & Revenue Collections Overview ───

@router.get("/financials/overview")
async def get_financials_overview(
    current_admin: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Get high-level SaaS revenue collections, MRR, and plan subscriber breakdowns. Admin only."""
    from sqlalchemy import select, func
    from app.modules.users.models import Profile, User
    from app.modules.jobs.models import Job

    # 1. Subscriber Counts by Plan Tier
    stmt = select(Profile.subscription_tier, func.count(Profile.id)).group_by(Profile.subscription_tier)
    res = await db.execute(stmt)
    tier_counts = {tier: count for tier, count in res.all()}

    starter_count = tier_counts.get("creator_lite", 0)
    pro_count = tier_counts.get("brand_pro", 0)
    business_count = tier_counts.get("enterprise_studio", 0)
    free_count = tier_counts.get("free", 0)
    total_paid_subscribers = starter_count + pro_count + business_count

    # 2. MRR (Monthly Recurring Revenue in INR)
    starter_mrr = starter_count * 699
    pro_mrr = pro_count * 1999
    business_mrr = business_count * 5999
    total_mrr = starter_mrr + pro_mrr + business_mrr

    # 3. Total One-Time Add-On Top-Up Revenue & Global Transactions
    profile_stmt = select(Profile, User).join(User, Profile.user_id == User.id)
    profile_res = await db.execute(profile_stmt)
    all_profiles = profile_res.all()

    total_topup_revenue = 0
    all_transactions = []

    for prof, usr in all_profiles:
        if prof.preferences and isinstance(prof.preferences, dict):
            txs = prof.preferences.get("transactions", [])
            for tx in txs:
                tx_copy = dict(tx)
                tx_copy["user_email"] = usr.email or "Unknown"
                tx_copy["user_id"] = str(usr.id)
                all_transactions.append(tx_copy)
                if tx.get("type") == "topup":
                    total_topup_revenue += tx.get("amount_inr", 0)

    # Sort transactions descending by date/timestamp
    all_transactions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    total_revenue = total_mrr + total_topup_revenue

    # 4. Total Visuals Processed
    job_stmt = select(func.count(Job.id))
    job_res = await db.execute(job_stmt)
    total_jobs = job_res.scalar() or 0

    return {
        "mrr_inr": total_mrr,
        "topup_revenue_inr": total_topup_revenue,
        "total_revenue_inr": total_revenue,
        "total_paid_subscribers": total_paid_subscribers,
        "plans_breakdown": {
            "starter": {"count": starter_count, "price_inr": 699, "total_inr": starter_mrr},
            "pro": {"count": pro_count, "price_inr": 1999, "total_inr": pro_mrr},
            "business": {"count": business_count, "price_inr": 5999, "total_inr": business_mrr},
            "free": {"count": free_count},
        },
        "recent_transactions": all_transactions[:20],
        "total_visuals_processed": total_jobs,
        "gross_margin_pct": 63.4,
    }

