"""AI Integrations — Base Protocols and Models."""

from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict


class GenerationResult(BaseModel):
    """The outcome of an AI generation provider call."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    image_bytes: bytes
    mime_type: str
    metadata: dict[str, Any] = {}
    provider_name: str


class AIProvider(Protocol):
    """Interface for external AI generation providers (OpenAI, Gemini, etc.)."""

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Execute a generation request.

        Args:
            prompt: The text prompt describing what to generate/edit.
            image_bytes: The source image bytes (for image-to-image or inpainting).
            config: Provider-specific configuration (e.g. style, seed, model parameters).

        Returns:
            GenerationResult: The generated image bytes and metadata.
        """
        ...
