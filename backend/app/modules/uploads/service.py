"""Uploads module — Service layer."""

import io
import uuid
from typing import ClassVar

from PIL import Image as PilImage
from PIL import UnidentifiedImageError

from sqlalchemy import select

from app.core.exceptions import ValidationError
from app.integrations.storage.base import StorageProvider
from app.modules.auth.schemas import CurrentUser
from app.modules.users.models import User
from app.modules.uploads.models import Image
from app.modules.uploads.repository import UploadRepository
from app.modules.uploads.schemas import PresignedUrlResponse


class UploadService:
    """Business logic for handling file uploads."""

    ALLOWED_CONTENT_TYPES: ClassVar[set[str]] = {"image/jpeg", "image/png", "image/webp"}
    MAX_FILE_SIZE_BYTES: ClassVar[int] = 10 * 1024 * 1024  # 10 MB

    def __init__(self, repository: UploadRepository, storage: StorageProvider) -> None:
        self._repo = repository
        self._storage = storage

    def _validate_image(self, content: bytes, content_type: str) -> tuple[int, int]:
        """Validate image using Pillow. Returns (width, height)."""
        if content_type not in self.ALLOWED_CONTENT_TYPES:
            raise ValidationError(
                message=f"Unsupported file type. Allowed: {', '.join(self.ALLOWED_CONTENT_TYPES)}"
            )

        if len(content) > self.MAX_FILE_SIZE_BYTES:
            raise ValidationError(message="File size exceeds the 10MB limit.")

        try:
            with PilImage.open(io.BytesIO(content)) as img:
                img.verify()  # verify() is fast, doesn't load pixel data
                return img.size
        except UnidentifiedImageError:
            raise ValidationError(message="File is corrupt or not a valid image.") from None
        except Exception as e:
            raise ValidationError(message=f"Image validation failed: {e!s}") from None

    async def _get_local_user_id(self, supabase_id: str) -> uuid.UUID:
        """Resolve the local database user ID from the Supabase auth ID."""
        stmt = select(User.id).where(User.supabase_id == supabase_id)
        result = await self._repo._session.execute(stmt)
        user_id = result.scalar_one_or_none()
        if not user_id:
            raise ValidationError(message="User account not found. Please log in again.")
        return user_id

    def _generate_storage_path(self, user_id: str, image_id: uuid.UUID, filename: str) -> str:
        """Generate a consistent storage path: {user_id}/originals/{image_id}{ext}"""
        ext = filename.split(".")[-1] if "." in filename else "bin"
        return f"{user_id}/originals/{image_id}.{ext}"

    async def upload_direct(
        self,
        current_user: CurrentUser,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> tuple[Image, str]:
        """Handle a direct file upload from the client.

        Returns:
            Tuple of (Image database record, access URL).
        """
        # Resolve local user ID
        local_user_id = await self._get_local_user_id(current_user.id)

        # 1. Validate
        width, height = self._validate_image(content, content_type)
        file_size = len(content)

        # 2. Generate path
        image_id = uuid.uuid4()
        storage_path = self._generate_storage_path(str(local_user_id), image_id, filename)

        # 3. Upload to Storage
        access_url = await self._storage.upload(
            file_path=storage_path,
            content=content,
            content_type=content_type,
        )

        # 4. Save to DB
        image = Image(
            id=image_id,
            user_id=local_user_id,
            original_filename=filename,
            storage_path=storage_path,
            file_size_bytes=file_size,
            content_type=content_type,
            width=width,
            height=height,
        )
        await self._repo.create_image(image)

        return image, access_url

    async def get_presigned_url(
        self,
        current_user: CurrentUser,
        filename: str,
        content_type: str,
        file_size_bytes: int,
    ) -> PresignedUrlResponse:
        """Generate a presigned URL for the client to upload directly to storage."""
        # Resolve local user ID
        local_user_id = await self._get_local_user_id(current_user.id)

        if content_type not in self.ALLOWED_CONTENT_TYPES:
            raise ValidationError(message="Unsupported file type.")
        if file_size_bytes > self.MAX_FILE_SIZE_BYTES:
            raise ValidationError(message="File size exceeds the 10MB limit.")

        image_id = uuid.uuid4()
        storage_path = self._generate_storage_path(str(local_user_id), image_id, filename)

        # Generate a PUT presigned URL for upload
        upload_url = await self._storage.get_signed_url(storage_path)
        access_url = await self._storage.get_signed_url(storage_path)  # Simplified

        # Save pending record to DB (could mark status='pending_upload')
        image = Image(
            id=image_id,
            user_id=local_user_id,
            original_filename=filename,
            storage_path=storage_path,
            file_size_bytes=file_size_bytes,
            content_type=content_type,
            width=None,  # Unknown until uploaded and verified
            height=None,
        )
        await self._repo.create_image(image)

        return PresignedUrlResponse(
            image_id=image_id,
            upload_url=upload_url,
            access_url=access_url,
        )

    async def list_images(self, current_user: CurrentUser) -> list[tuple[Image, str]]:
        """List user images with signed access URLs."""
        local_user_id = await self._get_local_user_id(current_user.id)
        images = await self._repo.get_user_images(str(local_user_id))

        result = []
        for img in images:
            # We must sign the URL again to grant read access
            url = await self._storage.get_signed_url(img.storage_path)
            result.append((img, url))

        return result
