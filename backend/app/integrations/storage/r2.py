try:
    import boto3
    from botocore.config import Config
except ImportError:
    boto3 = None
    Config = None

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class R2StorageProvider:
    """Storage provider using Cloudflare R2 (S3-compatible)."""

    def __init__(self, settings: Settings) -> None:
        if boto3 is None or Config is None:
            raise RuntimeError("boto3 is not installed in current environment")

        self.bucket_name = settings.r2_bucket_name
        self.public_domain = settings.r2_public_domain.rstrip('/') if settings.r2_public_domain else ""
        
        endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com" if settings.r2_account_id else None

        self.s3_client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto"
        )

    async def upload(self, file_path: str, content: bytes, content_type: str) -> str:
        """Upload content bytes to R2 bucket."""
        clean_path = file_path.lstrip('/')
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=clean_path,
            Body=content,
            ContentType=content_type
        )
        if self.public_domain:
            return f"{self.public_domain}/{clean_path}"
        return f"https://{self.bucket_name}.r2.cloudflarestorage.com/{clean_path}"

    async def download(self, file_path: str) -> bytes:
        """Download file content from R2 bucket."""
        clean_path = file_path.lstrip('/')
        response = self.s3_client.get_object(Bucket=self.bucket_name, Key=clean_path)
        return response['Body'].read()

    async def delete(self, file_path: str) -> bool:
        """Delete a file from R2 bucket."""
        clean_path = file_path.lstrip('/')
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=clean_path)
            return True
        except Exception as e:
            logger.warning("r2_delete_error", path=file_path, error=str(e))
            return False

    async def get_signed_url(self, file_path: str, expiration_seconds: int = 900) -> str:
        """Generate presigned download URL."""
        clean_path = file_path.lstrip('/')
        return self.s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket_name, 'Key': clean_path},
            ExpiresIn=expiration_seconds
        )
