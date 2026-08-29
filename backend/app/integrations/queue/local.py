"""Queue integration — Local BackgroundTasks implementation."""

import asyncio
import uuid
from typing import Any

import httpx
from fastapi import BackgroundTasks

from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.queue.base import QueueProvider

logger = get_logger(__name__)


class LocalQueueProvider(QueueProvider):
    """Local queue provider using asyncio/httpx to simulate Cloud Tasks.

    Since Cloud Tasks makes HTTP calls to our worker endpoints, this local provider
    makes a local HTTP POST request to the target URI asynchronously.
    """

    def __init__(self, settings: Settings, background_tasks: BackgroundTasks | None = None) -> None:
        self.settings = settings
        self.background_tasks = background_tasks

    async def _execute_task(self, target_uri: str, payload: dict[str, Any]) -> None:
        """Execute the task by making an HTTP call to our own API."""
        # For local dev, we assume the API is running on 127.0.0.1:8000
        # In a real setup, you might pass the base URL via settings
        base_url = "http://127.0.0.1:8000"
        url = f"{base_url}{target_uri}"

        logger.info("local_queue_dispatch", url=url, payload=payload)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=30.0)
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
