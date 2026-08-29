import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    action_metadata: dict[str, Any]
    ip_address: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class CostOverall(BaseModel):
    total_requests: int
    total_cost: float
    avg_latency_ms: float
    success_count: int
    failed_count: int


class CostByProviderModel(BaseModel):
    provider_name: str
    model: str
    request_count: int
    cost: float
    avg_latency: float


class CostSummaryResponse(BaseModel):
    overall: CostOverall
    by_provider_model: list[CostByProviderModel]
