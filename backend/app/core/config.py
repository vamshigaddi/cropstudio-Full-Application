"""CropStudio AI — Application Configuration.

All settings are loaded from environment variables via Pydantic Settings.
Secrets and connection strings MUST come from the environment, never hardcoded.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application-wide configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─── App ───
    app_name: str = "CropStudio AI"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: str = "development"  # development | staging | production

    # ─── API ───
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = [
        "https://cropstudio.automatexi.com",
        "https://app.cropstudio.automatexi.com",
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    # ─── Database ───
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/cropstudio"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_echo: bool = False

    # ─── Auth (Supabase) ───
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""

    # Storage / Integrations
    storage_provider: str = Field(
        default="local", description="Which storage provider to use: 'local', 'gcs', or 'r2'"
    )
    local_storage_path: str = Field(default="./storage", description="Path for local file storage")
    gcs_bucket_name: str = Field(default="", description="GCS bucket name for prod")
    gcs_project_id: str = Field(default="", description="GCP project ID")
    r2_account_id: str = Field(default="", description="Cloudflare R2 Account ID")
    r2_access_key_id: str = Field(default="", description="Cloudflare R2 Access Key ID")
    r2_secret_access_key: str = Field(default="", description="Cloudflare R2 Secret Access Key")
    r2_bucket_name: str = Field(default="", description="Cloudflare R2 Bucket Name")
    r2_public_domain: str = Field(default="", description="Cloudflare R2 Public Domain/URL")
    queue_provider: str = Field(
        default="local", description="Which queue provider to use: 'local' or 'cloud_tasks'"
    )
    cloud_tasks_project: str = ""
    cloud_tasks_location: str = ""
    cloud_tasks_queue: str = "default"
    worker_url: str = "http://localhost:8001"

    # ─── AI Providers ───
    gemini_api_key: str = ""
    openai_api_key: str = ""
    grok_api_key: str = ""

    # ─── Billing / Razorpay ───
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""

    # ─── Logging ───
    log_level: str = "INFO"
    log_json: bool = True


def get_settings() -> Settings:
    """Factory function to create settings instance. Enables DI and testing."""
    return Settings()
