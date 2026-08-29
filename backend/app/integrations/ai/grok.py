"""AI Integrations — Grok Provider."""

from typing import Any

import httpx
from openai import AsyncOpenAI, OpenAIError

from app.core.exceptions import ProviderError
from app.core.logging import get_logger
from app.integrations.ai.base import AIProvider, GenerationResult

logger = get_logger(__name__)


class GrokProvider(AIProvider):
    """Grok API provider using the `grok-imagine-image-quality` model.

    Communicates via the official `openai` SDK pointing to Grok's API endpoint.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        if not api_key:
            logger.warning("grok_api_key_missing")
        self.model = "grok-imagine-image-quality"
        self.base_url = "https://api.x.ai/v1"

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Call Grok's image generation API and download the resulting image."""
        if not self.api_key:
            raise ProviderError(
                provider="Grok",
                message="Grok API Key is not configured. Please set GROK_API_KEY in your environment.",
            )

        if image_bytes is not None:
            raise ProviderError(
                provider="Grok",
                message="Image-to-image generation is not supported by GrokProvider.",
            )

        # 1. Prepare parameters
        extra_body: dict[str, Any] = {}
        resolution = config.get("resolution", "1k")
        extra_body["resolution"] = resolution

        if "aspect_ratio" in config:
            extra_body["aspect_ratio"] = config["aspect_ratio"]

        params: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "extra_body": extra_body,
        }

        logger.info(
            "grok_image_generation_request",
            model=self.model,
            prompt=prompt,
            extra_params=extra_body,
        )

        # 2. Call x.ai API using OpenAI client wrapper
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        try:
            response = await client.images.generate(**params)
        except OpenAIError as e:
            logger.error("grok_api_error", error=str(e))
            raise ProviderError(
                provider="Grok",
                message=f"Grok API call failed: {e!s}",
            ) from e

        # 3. Parse response and download image
        try:
            if not response.data or not response.data[0]:
                raise ProviderError(
                    provider="Grok",
                    message="Grok API returned an empty data list.",
                )

            image_url = response.data[0].url
            if not image_url:
                raise ProviderError(
                    provider="Grok",
                    message="Grok API did not return an image URL.",
                )

            # Download the image bytes from the URL
            logger.info("grok_downloading_image", url=image_url)
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                img_response = await http_client.get(image_url)
                if img_response.status_code != 200:
                    raise ProviderError(
                        provider="Grok",
                        message=f"Failed to download image from Grok: HTTP status {img_response.status_code}",
                    )
                downloaded_bytes = img_response.content

            # Parse usage/cost if returned
            metadata = {
                "resolution": resolution,
            }
            usage = getattr(response, "usage", None)
            if usage:
                cost_ticks = getattr(usage, "cost_in_usd_ticks", None)
                if cost_ticks is not None:
                    metadata["cost_usd_ticks"] = cost_ticks
                    metadata["cost_usd"] = cost_ticks / 1e10

            mime_type = "image/png"
            if image_url.lower().endswith(".jpg") or image_url.lower().endswith(".jpeg"):
                mime_type = "image/jpeg"

            return GenerationResult(
                image_bytes=downloaded_bytes,
                mime_type=mime_type,
                metadata=metadata,
                provider_name="grok",
            )

        except Exception as e:
            if isinstance(e, ProviderError):
                raise
            logger.error("grok_parse_error", error=str(e))
            raise ProviderError(
                provider="Grok",
                message=f"Failed to process Grok API response: {e!s}",
            ) from e
