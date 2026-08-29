"""CropStudio AI — Health Check Endpoints.

Provides liveness and readiness probes for Cloud Run and monitoring.
"""

from fastapi import APIRouter

from app.core.database import check_db_health

router = APIRouter(tags=["Health"])


@router.get("/health")
async def liveness() -> dict[str, str]:
    """Liveness probe — returns OK if the process is running."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness() -> dict[str, str | bool]:
    """Readiness probe — checks database connectivity."""
    db_healthy = await check_db_health()
    if db_healthy:
        return {"status": "ok", "database": "connected"}
    return {"status": "degraded", "database": "disconnected"}
