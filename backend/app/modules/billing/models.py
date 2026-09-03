"""Billing module — Database models for dynamic plan & credit pack pricing."""

from datetime import datetime, timezone
import uuid
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from app.core.database import Base


class PlanPricing(Base):
    """Database model for subscription plan pricing and quotas."""

    __tablename__ = "plan_pricings"

    id = Column(String(50), primary_key=True)  # e.g. creator_lite, brand_pro, enterprise_studio
    display_name = Column(String(100), nullable=False)
    price_inr = Column(Integer, nullable=False, default=699)
    price_usd = Column(Integer, nullable=False, default=12)
    credits = Column(Integer, nullable=False, default=300)
    monthly_quota = Column(Integer, nullable=False, default=30)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self) -> str:
        return f"<PlanPricing id={self.id} inr={self.price_inr} usd={self.price_usd}>"


class CreditPackPricing(Base):
    """Database model for one-time credit pack purchases."""

    __tablename__ = "credit_pack_pricings"

    id = Column(String(50), primary_key=True)  # e.g. pack_100, pack_300, pack_600, pack_1500
    title = Column(String(100), nullable=False)
    credits = Column(Integer, nullable=False, default=100)
    images = Column(Integer, nullable=False, default=10)
    price_inr = Column(Integer, nullable=False, default=299)
    price_usd = Column(Integer, nullable=False, default=5)
    badge = Column(String(50), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self) -> str:
        return f"<CreditPackPricing id={self.id} inr={self.price_inr} usd={self.price_usd}>"
