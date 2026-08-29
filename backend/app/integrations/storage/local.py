"""Storage integration — Local filesystem implementation.

Intended for local development and testing only.
Saves files to the local disk and returns mock 'signed' URLs.
"""

import os
from pathlib import Path

import aiofiles

from app.core.config import Settings
from app.integrations.storage.base import StorageProvider


class LocalStorageProvider(StorageProvider):
    """Local storage provider using the filesystem."""

    def __init__(self, settings: Settings) -> None:
        self.base_path = Path(settings.local_storage_path)
        # Ensure the base directory exists
        self.base_path.mkdir(parents=True, exist_ok=True)

    async def upload(
        self,
        file_path: str,
        content: bytes,
        content_type: str,
    ) -> str:
        """Save the file to local disk."""
        full_path = self.base_path / file_path

        # Create parent directories if they don't exist
        full_path.parent.mkdir(parents=True, exist_ok=True)

        async with aiofiles.open(full_path, "wb") as f:
            await f.write(content)

        # In a real local setup, you might return a localhost URL pointing to a static file route
        # For now, we return the relative path
        return f"http://localhost:8000/local-storage/{file_path}"

    async def download(self, file_path: str) -> bytes:
        """Download a file from local disk."""
        full_path = self.base_path / file_path
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        async with aiofiles.open(full_path, "rb") as f:
            return await f.read()

    async def delete(self, file_path: str) -> bool:
        """Delete the file from local disk."""
        full_path = self.base_path / file_path
        try:
            os.remove(full_path)
            return True
        except FileNotFoundError:
            return False

    async def get_signed_url(self, file_path: str, expiration_seconds: int = 900) -> str:
        """Return a fake signed URL for local development."""
        # For local dev, we just return a fake URL that would be handled by a local file server
        return f"http://localhost:8000/local-storage/{file_path}?signed=true&expires={expiration_seconds}"
