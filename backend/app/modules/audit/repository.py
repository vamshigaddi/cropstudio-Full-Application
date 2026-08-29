"""Audit module — Database access."""

import uuid
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog


class AuditLogRepository:
    """Database access layer for AuditLog entities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_audit_log(
        self,
        actor_id: uuid.UUID | None,
        action: str,
        resource_type: str,
        resource_id: str | None,
        action_metadata: dict[str, Any],
        ip_address: str | None = None,
    ) -> AuditLog:
        """Create and save a new audit log entry."""
        audit_log = AuditLog(
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            action_metadata=action_metadata,
            ip_address=ip_address,
        )
        self._session.add(audit_log)
        await self._session.flush()
        return audit_log

    async def list_audit_logs(
        self,
        limit: int = 50,
        offset: int = 0,
        actor_id: uuid.UUID | None = None,
        action: str | None = None,
        resource_type: str | None = None,
    ) -> list[AuditLog]:
        """List all audit logs matching the criteria, ordered by created_at desc."""
        stmt = select(AuditLog)
        if actor_id is not None:
            stmt = stmt.where(AuditLog.actor_id == actor_id)
        if action is not None:
            stmt = stmt.where(AuditLog.action == action)
        if resource_type is not None:
            stmt = stmt.where(AuditLog.resource_type == resource_type)

        stmt = stmt.order_by(desc(AuditLog.created_at)).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
