"""Queue integration — Factory for creating queue providers."""

from fastapi import BackgroundTasks

from app.core.config import Settings
from app.integrations.queue.base import QueueProvider
from app.integrations.queue.cloud_tasks import CloudTasksProvider
from app.integrations.queue.local import LocalQueueProvider


def get_queue_provider(
    settings: Settings, background_tasks: BackgroundTasks | None = None
) -> QueueProvider:
    """Factory to return the configured queue provider.

    Args:
        settings: Application settings.
        background_tasks: Optional FastAPI BackgroundTasks for local execution.

    Returns:
        QueueProvider: The initialized queue provider.
    """
    # Use an environment variable like QUEUE_PROVIDER to select, default to local
    provider = getattr(settings, "queue_provider", "local")

    if provider.lower() == "gcs" or provider.lower() == "cloud_tasks":
        return CloudTasksProvider(settings)

    return LocalQueueProvider(settings, background_tasks)
