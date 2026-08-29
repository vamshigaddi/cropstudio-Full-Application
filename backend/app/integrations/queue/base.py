"""Queue integration — Base interface."""

from typing import Any, Protocol


class QueueProvider(Protocol):
    """Interface for all queue operations.

    Implementations (Local BackgroundTasks, Cloud Tasks) must conform to this protocol.
    """

    async def enqueue(
        self,
        queue_name: str,
        target_uri: str,
        payload: dict[str, Any],
    ) -> str:
        """Enqueue a task to be processed asynchronously.

        Args:
            queue_name: The name of the logical queue.
            target_uri: The internal API route that the worker will hit (e.g., "/api/v1/workers/jobs").
            payload: JSON serializable dictionary with task data.

        Returns:
            str: The task ID.
        """
        ...
