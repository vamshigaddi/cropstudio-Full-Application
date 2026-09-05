import asyncio
import os
import uuid
from typing import Any

import httpx
from fastapi import BackgroundTasks

from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.queue.base import QueueProvider

logger = get_logger(__name__)


class LocalQueueProvider(QueueProvider):
    """Local queue provider using direct internal service execution or dynamic local HTTP.

    Executes background generation jobs directly in memory or dispatches to the internal worker endpoint.
    """

    def __init__(self, settings: Settings, background_tasks: BackgroundTasks | None = None) -> None:
        self.settings = settings
        self.background_tasks = background_tasks

    async def _execute_task(self, target_uri: str, payload: dict[str, Any]) -> None:
        """Execute the task by calling internal service or local endpoint."""
        # 1. Try direct in-memory service execution first (fastest, 0 network overhead)
        if "/workers/jobs/process" in target_uri and "job_id" in payload:
            try:
                import app.modules.users.models  # noqa: F401
                import app.modules.batches.models  # noqa: F401
                import app.modules.jobs.models  # noqa: F401
                import app.modules.prompts.models  # noqa: F401
                import app.modules.uploads.models  # noqa: F401
                import app.modules.generation.models  # noqa: F401
                import app.modules.billing.models  # noqa: F401
                from app.core.database import _session_factory
                from app.core.events import get_event_bus
                from app.integrations.storage.factory import get_storage_provider
                from app.modules.generation.orchestrator import GenerationOrchestrator
                from app.modules.jobs.repository import JobRepository
                from app.modules.jobs.service import JobService

                if _session_factory:
                    async with _session_factory() as session:
                        repo = JobRepository(session)
                        storage = get_storage_provider(self.settings)
                        orchestrator = GenerationOrchestrator(session, self.settings, storage)
                        event_bus = get_event_bus()
                        service = JobService(repo, orchestrator, event_bus)

                        kwargs = {
                            "job_id_str": payload["job_id"],
                            "generation_mode": payload.get("generation_mode", "white_background"),
                        }
                        if payload.get("config") is not None:
                            kwargs["config"] = payload["config"]

                        logger.info("local_queue_direct_execution_started", job_id=payload["job_id"])
                        await service.process_job(**kwargs)
                        logger.info("local_queue_direct_execution_completed", job_id=payload["job_id"])
                        return
            except Exception as direct_err:
                logger.warning("direct_execution_failed_falling_back_to_http", error=str(direct_err))

        # 2. Fallback to dynamic HTTP dispatch
        port = os.environ.get("PORT", "10000")
        base_url = f"http://127.0.0.1:{port}"
        url = f"{base_url}{target_uri}"

        logger.info("local_queue_dispatch", url=url, payload=payload)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=60.0)
                response.raise_for_status()
                logger.info("local_queue_success", status=response.status_code)
        except Exception as e:
            logger.error("local_queue_failed", error=str(e))

    async def enqueue(
        self,
        queue_name: str,
        target_uri: str,
        payload: dict[str, Any],
    ) -> str:
        """Enqueue a task."""
        task_id = str(uuid.uuid4())

        if self.background_tasks:
            # If we have FastAPI BackgroundTasks in the request context, use it
            self.background_tasks.add_task(self._execute_task, target_uri, payload)
        else:
            # Otherwise, just spawn a background asyncio task
            task = asyncio.create_task(self._execute_task(target_uri, payload))
            # Store a strong reference so it's not garbage collected
            if not hasattr(self, "_background_tasks"):
                self._background_tasks: set[asyncio.Task[Any]] = set()
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

        return task_id
