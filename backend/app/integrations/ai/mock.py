"""AI Integrations — Mock Provider."""

import asyncio
import io
from typing import Any

from PIL import Image as PilImage

from app.core.logging import get_logger
from app.integrations.ai.base import AIProvider, GenerationResult

logger = get_logger(__name__)


class MockAIProvider(AIProvider):
    """Mock AI Provider for local testing without incurring API costs."""

    def __init__(self, provider_name: str = "mock-ai") -> None:
        self.provider_name = provider_name

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Simulate an AI generation process."""
        logger.info(
            "mock_provider_generate",
            prompt=prompt,
            has_image=image_bytes is not None,
            config=config,
        )

        # Simulate latency
        await asyncio.sleep(2.0)

        # Generate a placeholder image (e.g. a blue square with some text or just solid)
        # Using Pillow to create a valid image byte array
        img = PilImage.new("RGB", (512, 512), color="blue")
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format="PNG")
        mock_bytes = img_byte_arr.getvalue()

        return GenerationResult(
            image_bytes=mock_bytes,
            mime_type="image/png",
            metadata={"mocked": True, "prompt": prompt},
            provider_name=self.provider_name,
        )
