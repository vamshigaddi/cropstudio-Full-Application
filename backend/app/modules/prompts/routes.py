"""Prompts module — API routes."""

from collections.abc import Sequence

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.modules.auth.dependencies import require_admin
from app.modules.auth.schemas import CurrentUser
from app.modules.prompts.repository import PromptRepository
from app.modules.prompts.schemas import (
    CreateTemplateRequest,
    CreateVersionRequest,
    PromptTemplateResponse,
    PromptVersionResponse,
)
from app.modules.prompts.service import PromptService

router = APIRouter(prefix="/prompts", tags=["Prompts"])


def _get_prompt_service(
    session: AsyncSession = Depends(get_db_session),
) -> PromptService:
    """Dependency injection for PromptService."""
    repository = PromptRepository(session)
    return PromptService(repository)


@router.get("/", response_model=list[PromptTemplateResponse])
async def list_prompt_templates(
    current_user: CurrentUser = Depends(require_admin),
    service: PromptService = Depends(_get_prompt_service),
) -> Sequence[PromptTemplateResponse]:
    """List all prompt templates (admin only)."""
    templates = await service.list_templates()
    return [PromptTemplateResponse.model_validate(t) for t in templates]


@router.get("/{name}", response_model=PromptTemplateResponse)
async def get_prompt_template(
    name: str,
    current_user: CurrentUser = Depends(require_admin),
    service: PromptService = Depends(_get_prompt_service),
) -> PromptTemplateResponse:
    """Retrieve details of a prompt template by its unique name (admin only)."""
    template = await service.get_template(name)
    return PromptTemplateResponse.model_validate(template)


@router.post("/", response_model=PromptTemplateResponse)
async def create_prompt_template(
    request: CreateTemplateRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: PromptService = Depends(_get_prompt_service),
) -> PromptTemplateResponse:
    """Create a new prompt template with version 1 (admin only)."""
    template = await service.create_template(
        name=request.name,
        description=request.description,
        content=request.content,
    )
    return PromptTemplateResponse.model_validate(template)


@router.post("/{name}/versions", response_model=PromptVersionResponse)
async def add_prompt_version(
    name: str,
    request: CreateVersionRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: PromptService = Depends(_get_prompt_service),
) -> PromptVersionResponse:
    """Append a new version to an existing prompt template (admin only)."""
    version = await service.add_version(name=name, content=request.content)
    return PromptVersionResponse.model_validate(version)
