"""Audit module — Business logic service."""

import uuid
from typing import Any

from sqlalchemy import func, select

from app.modules.audit.models import AuditLog
from app.modules.audit.repository import AuditLogRepository
from app.modules.jobs.models import ProviderRequest


class AuditLogService:
    """Service layer coordinating audit logs and cost summary reporting."""

    def __init__(self, repository: AuditLogRepository) -> None:
        self._repository = repository
        self._session = repository._session

    async def log_action(
        self,
        actor_id: uuid.UUID | None,
        action: str,
        resource_type: str,
        resource_id: str | None,
        action_metadata: dict[str, Any],
        ip_address: str | None = None,
    ) -> AuditLog:
        """Log a new system/user action and commit the transaction."""
        audit_log = await self._repository.create_audit_log(
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            action_metadata=action_metadata,
            ip_address=ip_address,
        )
        await self._session.commit()
        return audit_log

    async def get_audit_logs(
        self,
        limit: int = 50,
        offset: int = 0,
        actor_id: uuid.UUID | None = None,
        action: str | None = None,
        resource_type: str | None = None,
    ) -> list[AuditLog]:
        """Retrieve paginated audit logs filtered by criteria."""
        return await self._repository.list_audit_logs(
            limit=limit,
            offset=offset,
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
        )

    async def get_cost_summary(self) -> dict[str, Any]:
        """Generate a summarized report of provider API request usage, latency, and costs."""
        # 1. Overall stats
        overall_stmt = select(
            func.count(ProviderRequest.id).label("total_requests"),
            func.sum(ProviderRequest.cost).label("total_cost"),
            func.avg(ProviderRequest.latency_ms).label("avg_latency"),
            func.count(ProviderRequest.id)
            .filter(ProviderRequest.status == "success")
            .label("success_count"),
            func.count(ProviderRequest.id)
            .filter(ProviderRequest.status == "failed")
            .label("failed_count"),
        )
        overall_res = await self._session.execute(overall_stmt)
        overall_row = overall_res.first()

        total_requests = overall_row.total_requests if overall_row else 0
        total_cost = (
            float(overall_row.total_cost)
            if overall_row and overall_row.total_cost is not None
            else 0.0
        )
        avg_latency = (
            float(overall_row.avg_latency)
            if overall_row and overall_row.avg_latency is not None
            else 0.0
        )
        success_count = overall_row.success_count if overall_row else 0
        failed_count = overall_row.failed_count if overall_row else 0

        # 2. Group by provider and model
        group_stmt = select(
            ProviderRequest.provider_name,
            ProviderRequest.model,
            func.count(ProviderRequest.id).label("request_count"),
            func.sum(ProviderRequest.cost).label("cost"),
            func.avg(ProviderRequest.latency_ms).label("avg_latency"),
        ).group_by(ProviderRequest.provider_name, ProviderRequest.model)

        group_res = await self._session.execute(group_stmt)
        by_provider_model = []
        for row in group_res:
            by_provider_model.append(
                {
                    "provider_name": row.provider_name,
                    "model": row.model,
                    "request_count": row.request_count,
                    "cost": float(row.cost) if row.cost is not None else 0.0,
                    "avg_latency": float(row.avg_latency) if row.avg_latency is not None else 0.0,
                }
            )

        return {
            "overall": {
                "total_requests": total_requests,
                "total_cost": total_cost,
                "avg_latency_ms": avg_latency,
                "success_count": success_count,
                "failed_count": failed_count,
            },
            "by_provider_model": by_provider_model,
        }
