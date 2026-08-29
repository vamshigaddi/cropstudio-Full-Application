"""CropStudio AI — Event Subscribers.

Contains all event handler functions that react to domain events.
These are registered with the EventBus at application startup.
"""

from app.core.events import (
    BatchCompletedEvent,
    DomainEvent,
    JobCompletedEvent,
    JobFailedEvent,
    QuotaExceededEvent,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


# ─── Logging Subscriber ───
# Logs every domain event for observability and debugging.


async def log_event_handler(event: DomainEvent) -> None:
    """Universal handler that logs every domain event."""
    logger.info(
        "domain_event",
        event_type=event.event_type,
        timestamp=event.timestamp.isoformat(),
        **event.metadata,
    )


# ─── Job Event Handlers ───


async def on_job_completed(event: DomainEvent) -> None:
    """Handle job.completed — could trigger notifications, analytics, etc."""
    assert isinstance(event, JobCompletedEvent)
    logger.info(
        "job_completed_handler",
        job_id=str(event.job_id),
        batch_id=str(event.batch_id),
        result_url=event.result_url,
    )
    # Future: Send push notification to user
    # Future: Update analytics dashboard
    # Future: Trigger webhook if configured


async def on_job_failed(event: DomainEvent) -> None:
    """Handle job.failed — could alert ops, trigger retries, etc."""
    assert isinstance(event, JobFailedEvent)
    logger.warning(
        "job_failed_handler",
        job_id=str(event.job_id),
        batch_id=str(event.batch_id),
        error=event.error_message,
        attempts=event.attempts,
    )
    # Future: Send alert to ops if attempts >= max
    # Future: Auto-retry with a different provider


# ─── Batch Event Handlers ───


async def on_batch_completed(event: DomainEvent) -> None:
    """Handle batch.completed — notify user that all images are ready."""
    assert isinstance(event, BatchCompletedEvent)
    logger.info(
        "batch_completed_handler",
        batch_id=str(event.batch_id),
        user_id=str(event.user_id),
        total=event.total_jobs,
        completed=event.completed_jobs,
        failed=event.failed_jobs,
    )
    # Future: Send email notification "Your batch is ready!"
    # Future: Trigger billing deduction


# ─── Quota Event Handlers ───


async def on_quota_exceeded(event: DomainEvent) -> None:
    """Handle quota.exceeded — log and potentially notify user."""
    assert isinstance(event, QuotaExceededEvent)
    logger.warning(
        "quota_exceeded_handler",
        user_id=str(event.user_id),
        requested=event.requested,
        limit=event.limit,
    )
    # Future: Send upgrade prompt to user


# ─── Audit Event Handler ───


async def audit_event_handler(event: DomainEvent) -> None:
    """Subscriber that writes domain events to the AuditLog database table."""
    from app.core.database import get_session_factory
    from app.modules.audit.repository import AuditLogRepository

    # Map event type to resource type/id/actor
    actor_id = None
    action = event.event_type
    resource_type = "system"
    resource_id = None
    action_metadata = dict(event.metadata)

    if isinstance(event, JobCompletedEvent):
        resource_type = "job"
        resource_id = str(event.job_id) if event.job_id else None
        action_metadata.update(
            {
                "batch_id": str(event.batch_id) if event.batch_id else None,
                "result_url": event.result_url,
            }
        )
    elif isinstance(event, JobFailedEvent):
        resource_type = "job"
        resource_id = str(event.job_id) if event.job_id else None
        action_metadata.update(
            {
                "batch_id": str(event.batch_id) if event.batch_id else None,
                "error_message": event.error_message,
                "attempts": event.attempts,
            }
        )
    elif isinstance(event, BatchCompletedEvent):
        resource_type = "batch"
        resource_id = str(event.batch_id) if event.batch_id else None
        actor_id = event.user_id
        action_metadata.update(
            {
                "total_jobs": event.total_jobs,
                "completed_jobs": event.completed_jobs,
                "failed_jobs": event.failed_jobs,
            }
        )
    elif isinstance(event, QuotaExceededEvent):
        resource_type = "user"
        resource_id = str(event.user_id) if event.user_id else None
        actor_id = event.user_id
        action_metadata.update(
            {
                "requested": event.requested,
                "limit": event.limit,
            }
        )

    try:
        session_factory = get_session_factory()
    except RuntimeError:
        # DB not initialized (e.g. in some isolated test cases)
        logger.warning("database_not_initialized_skipping_audit_log")
        return

    async with session_factory() as session:
        try:
            repo = AuditLogRepository(session)
            await repo.create_audit_log(
                actor_id=actor_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                action_metadata=action_metadata,
            )
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.error("audit_event_handler_failed", error=str(e), event_type=event.event_type)
