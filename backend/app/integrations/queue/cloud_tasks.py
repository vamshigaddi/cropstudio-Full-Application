"""Queue integration — Google Cloud Tasks implementation."""

import json
from typing import Any

from google.cloud import tasks_v2

from app.core.config import Settings
from app.core.logging import get_logger
from app.integrations.queue.base import QueueProvider

logger = get_logger(__name__)


class CloudTasksProvider(QueueProvider):
    """Google Cloud Tasks provider."""

    _client: tasks_v2.CloudTasksAsyncClient | None

    def __init__(self, settings: Settings) -> None:
        self.project_id = settings.gcs_project_id  # Assuming same project
        self.location = "us-central1"  # Ideally from settings
        self.base_url = "https://your-cloud-run-url.com"  # Ideally from settings
        self.service_account_email = None  # Ideally from settings for OIDC auth

        try:
            self._client = tasks_v2.CloudTasksAsyncClient()
        except Exception as e:
            logger.warning("cloud_tasks_init_failed", error=str(e))
            self._client = None

    def _get_queue_path(self, queue_name: str) -> str:
        """Construct the fully qualified queue path."""
        if not self._client:
            raise RuntimeError("Cloud Tasks Client not properly initialized.")
        return self._client.queue_path(self.project_id, self.location, queue_name)

    async def enqueue(
        self,
        queue_name: str,
        target_uri: str,
        payload: dict[str, Any],
    ) -> str:
        """Enqueue a task to Cloud Tasks."""
        if not self._client:
            raise RuntimeError("Cloud Tasks Client not properly initialized.")

        queue_path = self._get_queue_path(queue_name)
        url = f"{self.base_url}{target_uri}"

        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": url,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(payload).encode(),
            }
        }

        # In production, add OIDC token for secure service-to-service auth
        if self.service_account_email:
            task["http_request"]["oidc_token"] = {
                "service_account_email": self.service_account_email
            }

        response = await self._client.create_task(request={"parent": queue_path, "task": task})

        return response.name
