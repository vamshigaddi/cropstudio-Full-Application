"""CropStudio AI — In-process Domain Event Bus.

A lightweight pub/sub system for domain events. Handlers are registered
at startup and invoked asynchronously when events are published.

Initial implementation: in-process async event bus.
Future: swap to Google Pub/Sub for cross-service eventing.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.core.logging import get_logger

if TYPE_CHECKING:
    from uuid import UUID

logger = get_logger(__name__)

# Type alias for async event handlers
EventHandler = Callable[["DomainEvent"], Coroutine[Any, Any, None]]


# ─── Domain Event Base ───


@dataclass(frozen=True)
class DomainEvent:
    """Base class for all domain events."""

    event_type: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(tz=UTC))
    metadata: dict[str, Any] = field(default_factory=dict)


# ─── Concrete Domain Events ───


@dataclass(frozen=True)
class JobCompletedEvent(DomainEvent):
    """Fired when a generation job completes successfully."""

    event_type: str = "job.completed"
    job_id: UUID | None = None
    batch_id: UUID | None = None
    user_id: UUID | None = None
    result_url: str | None = None


@dataclass(frozen=True)
class JobFailedEvent(DomainEvent):
    """Fired when a generation job fails after processing."""

    event_type: str = "job.failed"
    job_id: UUID | None = None
    batch_id: UUID | None = None
    user_id: UUID | None = None
    error_message: str | None = None
    attempts: int = 0


@dataclass(frozen=True)
class BatchCompletedEvent(DomainEvent):
    """Fired when all jobs in a batch have finished (completed or failed)."""

    event_type: str = "batch.completed"
    batch_id: UUID | None = None
    user_id: UUID | None = None
    total_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0


@dataclass(frozen=True)
class QuotaExceededEvent(DomainEvent):
    """Fired when a user's action is blocked due to quota limits."""

    event_type: str = "quota.exceeded"
    user_id: UUID | None = None
    requested: int = 0
    limit: int = 0


# ─── Event Bus ───


class EventBus:
    """In-process async event bus.

    Subscribe handlers to specific event types, then publish events
    to trigger all registered handlers.

    Thread-safe for single-process async applications (FastAPI).
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = defaultdict(list)

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        """Register a handler for a specific event type.

        Args:
            event_type: The event type string to listen for (e.g., "job.completed").
            handler: An async callable that accepts a DomainEvent.
        """
        self._handlers[event_type].append(handler)
        logger.debug("event_handler_registered", event_type=event_type, handler=handler.__name__)

    async def publish(self, event: DomainEvent) -> None:
        """Publish an event to all registered handlers.

        Handlers are executed concurrently via asyncio.gather.
        A failing handler does NOT prevent other handlers from executing.

        Args:
            event: The domain event to publish.
        """
        handlers = self._handlers.get(event.event_type, [])
        if not handlers:
            logger.debug("event_no_handlers", event_type=event.event_type)
            return

        logger.info(
            "event_publishing",
            event_type=event.event_type,
            handler_count=len(handlers),
        )

        # Run all handlers concurrently, catching individual failures
        results = await asyncio.gather(
            *[self._safe_invoke(handler, event) for handler in handlers],
            return_exceptions=True,
        )

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(
                    "event_handler_failed",
                    event_type=event.event_type,
                    handler=handlers[i].__name__,
                    error=str(result),
                )

    @staticmethod
    async def _safe_invoke(handler: EventHandler, event: DomainEvent) -> None:
        """Invoke a handler, catching and logging any exceptions."""
        try:
            await handler(event)
        except Exception as e:
            logger.error(
                "event_handler_exception",
                handler=handler.__name__,
                event_type=event.event_type,
                error=str(e),
            )
            raise


# ─── Global Event Bus Singleton ───

_event_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Get (or create) the global event bus singleton."""
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus


def reset_event_bus() -> None:
    """Reset the global event bus. Used in testing."""
    global _event_bus
    _event_bus = None
