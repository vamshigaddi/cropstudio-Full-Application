"""Jobs module — Internal Worker API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.core.events import get_event_bus
from app.integrations.storage.factory import get_storage_provider
from app.modules.generation.orchestrator import GenerationOrchestrator
from app.modules.jobs.repository import JobRepository
from app.modules.jobs.schemas import ProcessJobRequest
from app.modules.jobs.service import JobService

router = APIRouter(prefix="/workers/jobs", tags=["Workers"])


def _get_job_service(
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> JobService:
    """Dependency injection for JobService."""
    repo = JobRepository(session)
    storage = get_storage_provider(settings)
    orchestrator = GenerationOrchestrator(session, settings, storage)
    event_bus = get_event_bus()
    return JobService(repo, orchestrator, event_bus)


@router.post("/process", status_code=200)
async def process_job_route(
    request: ProcessJobRequest,
    service: JobService = Depends(_get_job_service),
) -> dict[str, str]:
    """Internal endpoint called by the queue to process a job.

    Cloud Tasks expects a 2xx response for success.
    Any 5xx or unhandled exception will cause Cloud Tasks to retry.
    """
    try:
        kwargs = {
            "job_id_str": request.job_id,
            "generation_mode": request.generation_mode,
        }
        if request.config is not None:
            kwargs["config"] = request.config
        await service.process_job(**kwargs)
        return {"status": "success"}
    except Exception as e:
        # We must return a 500 so Cloud Tasks knows it failed and will retry it
        raise HTTPException(status_code=500, detail=str(e)) from e
