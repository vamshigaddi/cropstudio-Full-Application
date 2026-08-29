"""Storage integration — Google Cloud Storage implementation.

Intended for staging and production environments.
"""

from datetime import timedelta
from typing import cast

from google.cloud import storage

from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.storage.base import StorageProvider

logger = get_logger(__name__)


class GCSProvider(StorageProvider):
    """Google Cloud Storage provider."""

    _client: storage.Client | None
    _bucket: storage.Bucket | None

    def __init__(self, settings: Settings) -> None:
        self.bucket_name = settings.gcs_bucket_name
        self.project_id = settings.gcs_project_id
        # Client initialized lazily or on instantiation if credentials are provided in env
        try:
            self._client = storage.Client(project=self.project_id)
            self._bucket = self._client.bucket(self.bucket_name)
        except Exception as e:
            logger.warning("gcs_client_init_failed", error=str(e))
            self._client = None
            self._bucket = None

    def _ensure_bucket(self) -> storage.Bucket:
        if not self._bucket:
            raise RuntimeError("GCS Client not properly initialized.")
        return self._bucket

    async def upload(
        self,
        file_path: str,
        content: bytes,
        content_type: str,
    ) -> str:
        """Upload a file to Google Cloud Storage (synchronously wrapped).

        Ideally, GCS operations should be run in a threadpool for async compatibility,
        or using an async GCS library. We wrap standard client calls here.
        """
        import asyncio

        loop = asyncio.get_running_loop()

        def _upload() -> str:
            bucket = self._ensure_bucket()
            blob = bucket.blob(file_path)
            blob.upload_from_string(content, content_type=content_type)
            return f"gs://{self.bucket_name}/{file_path}"

        return await loop.run_in_executor(None, _upload)

    async def download(self, file_path: str) -> bytes:
        """Download a file from GCS."""
        bucket = self._ensure_bucket()
        import asyncio

        loop = asyncio.get_running_loop()

        def _download() -> bytes:
            blob = bucket.blob(file_path)
            return cast("bytes", blob.download_as_bytes())

        return await loop.run_in_executor(None, _download)

    async def delete(self, file_path: str) -> bool:
        """Delete the file from GCS."""
        import asyncio

        loop = asyncio.get_running_loop()

        def _delete() -> bool:
            try:
                bucket = self._ensure_bucket()
                blob = bucket.blob(file_path)
                blob.delete()
                return True
            except Exception as e:
                logger.error("gcs_delete_failed", path=file_path, error=str(e))
                return False

        return await loop.run_in_executor(None, _delete)

    async def get_signed_url(self, file_path: str, expiration_seconds: int = 900) -> str:
        """Return a signed URL for GCS."""
        import asyncio

        loop = asyncio.get_running_loop()

        def _get_url() -> str:
            bucket = self._ensure_bucket()
            blob = bucket.blob(file_path)
            # Requires service account credentials with signing permissions
            return cast(
                "str",
                blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(seconds=expiration_seconds),
                    method="GET",
                ),
            )

        return await loop.run_in_executor(None, _get_url)
