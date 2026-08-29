"""Prompts module — Service layer."""

from collections.abc import Sequence
from typing import Any

from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.modules.prompts.models import PromptTemplate, PromptVersion
from app.modules.prompts.repository import PromptRepository

logger = get_logger(__name__)


class PromptService:
    """Business logic for Prompt templates, versions, and variable resolution."""

    def __init__(self, prompt_repo: PromptRepository) -> None:
        self._repo = prompt_repo

    async def get_template(self, name: str) -> PromptTemplate:
        """Get template by name or raise NotFoundError."""
        template = await self._repo.get_template_by_name(name)
        if not template:
            raise NotFoundError(resource="PromptTemplate", identifier=name)
        return template

    async def list_templates(self) -> Sequence[PromptTemplate]:
        """List all prompt templates."""
        return await self._repo.list_templates()

    async def create_template(
        self, name: str, description: str | None, content: str
    ) -> PromptTemplate:
        """Create a new template and commit."""
        # Check validation
        if not content.strip():
            raise ValidationError(message="Prompt content cannot be empty.")
        template = await self._repo.create_template(name, description, content)
        await self._repo._session.commit()
        logger.info("prompt_template_created", name=name)
        return template

    async def add_version(self, name: str, content: str) -> PromptVersion:
        """Add a new version to an existing template."""
        if not content.strip():
            raise ValidationError(message="Prompt content cannot be empty.")
        version = await self._repo.add_version(name, content)
        await self._repo._session.commit()
        logger.info("prompt_version_added", name=name, version=version.version)
        return version

    async def resolve_prompt(
        self, template_name: str, config: dict[str, Any]
    ) -> tuple[str, PromptVersion]:
        """Resolve variables in the latest version of a template.

        Args:
            template_name: The name of the template (e.g. "studio_lighting").
            config: A dictionary containing placeholder keys and values.

        Returns:
            A tuple of (resolved_prompt_string, PromptVersion object used).
        """
        version = await self._repo.get_latest_version(template_name)
        if not version:
            raise NotFoundError(resource="PromptVersion", identifier=f"{template_name} (latest)")

        resolved = self._format_prompt(version.content, config)
        return resolved, version

    def _format_prompt(self, content: str, config: dict[str, Any]) -> str:
        """Format the content template using the provided configuration.

        Falls back gracefully if formatting keys are missing.
        """

        # Convert all keys/values to string representation or handle gracefully
        # Use Python's format but handle missing keys without crashing.
        # Safe formatting with a fallback dictionary or formatting logic:
        class SafeDict(dict[str, Any]):
            def __missing__(self, key: str) -> str:
                return f"{{{key}}}"

        try:
            # We want to format string safely, leaving unresolved placeholders intact
            return content.format_map(SafeDict(config))
        except Exception as e:
            logger.error("prompt_format_error", content=content, config=config, error=str(e))
            return content
