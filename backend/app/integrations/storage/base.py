"""Storage integration — Base interface."""

from typing import Protocol


class StorageProvider(Protocol):
    """Interface for all storage operations.

    Implementations (Local, GCS, S3) must conform to this protocol.
    """

    async def upload(
        self,
        file_path: str,
        content: bytes,
        content_type: str,
    ) -> str:
        """Upload a file to storage.

        Args:
            file_path: The destination path (e.g., 'user-1/original/img.png').
            content: The raw bytes of the file.
            content_type: The MIME type of the file.

        Returns:
            str: The public URL or path to access the uploaded file.
        """
        ...

    async def download(self, file_path: str) -> bytes:
        """Download a file from storage.

        Args:
            file_path: The path of the file to download.

        Returns:
            bytes: The raw bytes of the file.
        """
        ...

    async def delete(self, file_path: str) -> bool:
        """Delete a file from storage.

        Args:
            file_path: The path of the file to delete.

        Returns:
            bool: True if deleted successfully.
        """
        ...

    async def get_signed_url(self, file_path: str, expiration_seconds: int = 900) -> str:
        """Generate a presigned URL for downloading or uploading.

        Args:
            file_path: The path of the file.
            expiration_seconds: How long the URL is valid for (default 15 mins).

        Returns:
            str: The signed URL.
        """
        ...
