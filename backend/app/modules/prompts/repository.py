"""Prompts module — Repository layer."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationError
from app.modules.prompts.models import PromptTemplate, PromptVersion


class PromptRepository:
    """Handles DB operations for PromptTemplates and PromptVersions."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_template_by_name(self, name: str) -> PromptTemplate | None:
        """Fetch a prompt template by its unique name."""
        stmt = (
            select(PromptTemplate)
            .where(PromptTemplate.name == name)
            .options(selectinload(PromptTemplate.versions))
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_template_by_id(self, template_id: uuid.UUID) -> PromptTemplate | None:
        """Fetch a prompt template by its ID."""
        stmt = (
            select(PromptTemplate)
            .where(PromptTemplate.id == template_id)
            .options(selectinload(PromptTemplate.versions))
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_templates(self) -> Sequence[PromptTemplate]:
        """List all prompt templates."""
        stmt = (
            select(PromptTemplate)
            .order_by(PromptTemplate.name.asc())
            .options(selectinload(PromptTemplate.versions))
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_latest_version(self, template_name: str) -> PromptVersion | None:
        """Fetch the latest active version of a template by template name."""
        stmt = (
            select(PromptVersion)
            .join(PromptTemplate)
            .where(PromptTemplate.name == template_name)
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_template(
        self, name: str, description: str | None, content: str
    ) -> PromptTemplate:
        """Create a new template and its first version (version 1)."""
        existing = await self.get_template_by_name(name)
        if existing:
            raise ValidationError(message=f"Prompt template '{name}' already exists.")

        template = PromptTemplate(name=name, description=description)
        self._session.add(template)
        # Flush to get template ID
        await self._session.flush()

        version = PromptVersion(template_id=template.id, version=1, content=content)
        self._session.add(version)
        await self._session.flush()

        # Eager load versions list
        await self._session.refresh(template, attribute_names=["versions"])
        return template

    async def add_version(self, template_name: str, content: str) -> PromptVersion:
        """Add a new version to an existing template."""
        template = await self.get_template_by_name(template_name)
        if not template:
            raise NotFoundError(resource="PromptTemplate", identifier=template_name)

        # Find the max version number
        latest = await self.get_latest_version(template_name)
        next_version = (latest.version + 1) if latest else 1

        version = PromptVersion(
            template_id=template.id,
            version=next_version,
            content=content,
        )
        self._session.add(version)
        await self._session.flush()
        return version
