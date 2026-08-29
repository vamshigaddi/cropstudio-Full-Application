"""Generation module — SQLAlchemy models for provider settings."""

from datetime import datetime

from sqlalchemy import DateTime, String, Boolean, func, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProviderSetting(Base):
    """Configuration state for LLM/AI model providers (enabled/disabled toggles)."""

    __tablename__ = "provider_settings"

    provider_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<ProviderSetting provider_name={self.provider_name} is_enabled={self.is_enabled}>"


class ModelPricing(Base):
    """Configuration and pricing parameters for specific LLM/AI models."""

    __tablename__ = "model_pricings"

    model_name: Mapped[str] = mapped_column(String(50), primary_key=True)
    provider_name: Mapped[str] = mapped_column(String(50), nullable=False)
    pricing_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<ModelPricing model_name={self.model_name} provider={self.provider_name}>"
