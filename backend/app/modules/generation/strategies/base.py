"""Generation strategies — Base Protocol."""

from typing import Any, Protocol

from app.integrations.ai.base import GenerationResult
from app.modules.jobs.models import Job


class GenerationStrategy(Protocol):
    """Protocol for all image generation strategies.

    A strategy handles the entire lifecycle of a specific generation mode (e.g. background_removal, upscale).
    It may use local libraries (like rembg) or external AI providers.
    """

    async def execute(
        self,
        job: Job,
        input_image_bytes: bytes,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Execute the generation strategy.

        Args:
            job: The Job database record.
            input_image_bytes: The original source image bytes.
            config: Any configuration needed for generation.

        Returns:
            GenerationResult: The resulting image bytes and metadata.
        """
        ...
