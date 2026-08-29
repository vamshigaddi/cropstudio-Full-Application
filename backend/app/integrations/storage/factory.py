"""Storage integration — Factory for creating storage providers."""

from app.core.config import Settings
from app.integrations.storage.base import StorageProvider
from app.integrations.storage.gcs import GCSProvider
from app.integrations.storage.local import LocalStorageProvider
from app.integrations.storage.r2 import R2StorageProvider


def get_storage_provider(settings: Settings) -> StorageProvider:
    """Factory to return the configured storage provider.

    Args:
        settings: Application settings.

    Returns:
        StorageProvider: The initialized storage provider (Local, GCS, or R2).
    """
    provider = settings.storage_provider.lower()
    if provider in ["r2", "s3"]:
        return R2StorageProvider(settings)
    if provider == "gcs":
        return GCSProvider(settings)

    # Default to local
    return LocalStorageProvider(settings)
