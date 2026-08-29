"""Generation strategies — External AI Provider (Gemini/OpenAI)."""

from typing import Any

from app.core.logging import get_logger
from app.integrations.ai.base import AIProvider, GenerationResult
from app.modules.generation.strategies.base import GenerationStrategy
from app.modules.jobs.models import Job

logger = get_logger(__name__)


class ExternalProviderStrategy(GenerationStrategy):
    """Strategy that delegates to an external AI Provider (OpenAI, Gemini, etc.)."""

    def __init__(self, provider: AIProvider, prompt_template: str) -> None:
        self.provider = provider
        self.prompt_template = prompt_template

    def _build_prompt(self, config: dict[str, Any]) -> str:
        """Format the prompt template with config variables."""
        defaults = {
            "model_description": "professional",
            "clothing_item": "clothing",
            "setting": "beautiful setting",
            "lighting": "natural",
            "style": "modern",
            "category": "product",
            "surface_type": "clean",
        }
        full_config = {**defaults, **(config or {})}
        try:
            return self.prompt_template.format(**full_config)
        except Exception as e:
            logger.warning("prompt_format_failed", error=str(e))
            return self.prompt_template

    async def execute(
        self,
        job: Job,
        input_image_bytes: bytes,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Execute the external provider generation."""
        logger.info("executing_external_provider_strategy", job_id=str(job.id))

        prompt = config.get("prompt")
        if not prompt:
            prompt = self._build_prompt(config)

        # Call the AI provider
        result = await self.provider.generate(
            prompt=prompt,
            image_bytes=input_image_bytes,
            config=config,
        )

        return result
