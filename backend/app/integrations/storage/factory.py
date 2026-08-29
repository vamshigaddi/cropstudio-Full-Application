"""Storage integration — Factory for creating storage providers."""

from app.core.config import Settings
from app.integrations.storage.base import StorageProvider
from app.integrations.storage.gcs import GCSProvider
from app.integrations.storage.local import LocalStorageProvider


def get_storage_provider(settings: Settings) -> StorageProvider:
    """Factory to return the configured storage provider.

    Args:
        settings: Application settings.

    Returns:
        StorageProvider: The initialized storage provider (Local or GCS).
    """
    if settings.storage_provider.lower() == "gcs":
        return GCSProvider(settings)

    # Default to local
    return LocalStorageProvider(settings)
