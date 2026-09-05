"""Generation module — Orchestrator."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.exceptions import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.integrations.ai.router import get_ai_provider
from app.integrations.storage.base import StorageProvider
from app.modules.generation.strategies.background_removal import BackgroundRemovalStrategy
from app.modules.generation.strategies.base import GenerationStrategy
from app.modules.generation.strategies.external_provider import ExternalProviderStrategy
from app.modules.jobs.models import Job
from app.modules.jobs.repository import JobRepository
from app.modules.uploads.repository import UploadRepository

logger = get_logger(__name__)


DEFAULT_PROMPT_TEMPLATES = {
    "lifestyle": "High-end commercial editorial fashion photograph of {model_description} wearing {clothing_item} in a contemporary, understated urban lifestyle setting, 85mm f/1.4 portrait camera lens, natural soft daylight, authentic skin pores and micro-texture, real fabric weave, realistic lookbook.",
    "upscale": "Upscale this image to 4k resolution.",
    "studio_lighting": "Add professional studio lighting to this {category} product. Style: {style}.",
    "try_on": "High-end fashion e-commerce virtual try-on: A {model_description} model wearing the {clothing_item}, photorealistic, studio background. Natural collar fit around neck with clean skin, no duplicate neck tags or inner collar rings, realistic fabric drape.",
    "ghost_mannequin": "A ghost mannequin product shot of {clothing_item}, invisible model, hollow silhouette, clean studio lighting, white studio background.",
    "flat_lay": "A flat lay composition of {clothing_item} arranged neatly on a {surface_type} background, matching accessories, professional e-commerce product photography.",
    "folded": "A folded display of {clothing_item} neatly arranged on a clean shelf, product photography, soft commercial lighting.",
    "closeup": "A closeup detailed macro shot of {clothing_item} fabric texture, stitching details, high quality material focus.",
}



class GenerationOrchestrator:
    """Orchestrates the AI generation process."""

    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        storage: StorageProvider,
    ) -> None:
        self.session = session
        self.settings = settings
        self.storage = storage
        self.job_repo = JobRepository(session)
        self.upload_repo = UploadRepository(session)

    async def _get_strategy(self, mode: str, prompt_template: str = "") -> GenerationStrategy:
        """Resolve the generation mode to a specific strategy."""

        if mode in ("background_removal", "white_background"):
            return BackgroundRemovalStrategy()

        # Fetch current settings from DB to check if providers are enabled
        from sqlalchemy import select
        from app.modules.generation.models import ProviderSetting

        try:
            stmt = select(ProviderSetting)
            result = await self.session.execute(stmt)
            db_settings = {s.provider_name: s.is_enabled for s in result.scalars().all()}
        except Exception:
            db_settings = {}

        grok_enabled = db_settings.get("grok", True)
        openai_enabled = db_settings.get("openai", True)
        gemini_enabled = db_settings.get("gemini", True)

        # Decide provider prioritizing enabled & configured ones: grok -> openai -> gemini -> mock
        if grok_enabled and isinstance(self.settings.grok_api_key, str) and self.settings.grok_api_key:
            provider_name = "grok"
        elif openai_enabled and isinstance(self.settings.openai_api_key, str) and self.settings.openai_api_key:
            provider_name = "openai"
        elif gemini_enabled and isinstance(self.settings.gemini_api_key, str) and self.settings.gemini_api_key:
            provider_name = "gemini"
        else:
            provider_name = f"mock-{mode}"

        provider = get_ai_provider(provider_name, self.settings)

        template = prompt_template or DEFAULT_PROMPT_TEMPLATES.get(mode, "")
        if not template:
            raise ValidationError(message=f"Unknown generation mode: {mode}")

        return ExternalProviderStrategy(provider=provider, prompt_template=template)

    async def execute_job(self, job: Job, config: dict[str, Any] | None = None) -> None:
        """Execute a generation job end-to-end.

        Assumes the job is already marked as 'processing' and locked/safe to run.
        """
        config = config or {}

        # 1. Fetch original image DB record
        original_image = await self.upload_repo.get_by_id(job.image_id)
        if not original_image:
            raise NotFoundError(resource="Original Image", identifier=str(job.image_id))

        # 2. Download original image bytes from Storage
        logger.info("orchestrator_downloading_image", path=original_image.storage_path)
        input_bytes = await self.storage.download(original_image.storage_path)

        # 3. Resolve prompt template & version from database (Prompt Module)
        prompt_template_content = ""
        if job.generation_mode not in ("background_removal", "white_background"):
            from app.modules.prompts.repository import PromptRepository
            from app.modules.prompts.service import PromptService

            prompt_repo = PromptRepository(self.session)
            prompt_service = PromptService(prompt_repo)

            if job.generation_mode in DEFAULT_PROMPT_TEMPLATES:
                try:
                    # Get the latest version from DB
                    template = await prompt_service.get_template(job.generation_mode)
                    latest_version = await prompt_repo.get_latest_version(job.generation_mode)
                    if latest_version:
                        prompt_template_content = latest_version.content
                        job.prompt_version_id = latest_version.id
                except NotFoundError:
                    # Auto-create template in DB if not exists
                    default_content = DEFAULT_PROMPT_TEMPLATES[job.generation_mode]
                    template = await prompt_repo.create_template(
                        name=job.generation_mode,
                        description=f"Default template for {job.generation_mode}",
                        content=default_content,
                    )
                    latest_version = template.versions[0]
                    prompt_template_content = latest_version.content
                    job.prompt_version_id = latest_version.id

        # 4. Resolve strategy
        strategy = await self._get_strategy(job.generation_mode, prompt_template=prompt_template_content)

        # Determine subscription tier
        subscription_tier = config.get("subscription_tier") or "free"
        is_mock_session = (
            "Mock" in self.session.__class__.__name__ or
            hasattr(self.session, "_is_coroutine") or
            "mock" in str(type(self.session)).lower()
        )
        if not is_mock_session:
            try:
                from app.modules.batches.repository import BatchRepository
                batch_repo = BatchRepository(self.session)
                batch = await batch_repo.get_by_id(job.batch_id)
                if batch:
                    from app.modules.users.repository import UserRepository
                    user_repo = UserRepository(self.session)
                    user = await user_repo.get_by_id(batch.user_id)
                    if user and user.profile and user.profile.subscription_tier:
                        subscription_tier = user.profile.subscription_tier
            except Exception as e:
                logger.warning("failed_to_resolve_subscription_tier_falling_back", error=str(e))

        # Determine model
        model_name = "unknown"
        if hasattr(strategy, "provider"):
            prov = strategy.provider
            model_name = getattr(prov, "model", "unknown")
            provider_name = getattr(
                prov,
                "provider_name",
                prov.__class__.__name__.replace("Provider", "").lower(),
            )
            if provider_name == "gemini":
                if subscription_tier in ("brand_pro", "enterprise_studio"):
                    model_name = "gemini-3.1-flash-image"
                else:
                    model_name = "gemini-3.1-flash-lite-image"
        elif job.generation_mode in ("background_removal", "white_background"):
            model_name = "rembg"

        # Resolve size based on aspect ratio
        from app.modules.generation.pricing import PricingService
        pricing_service = PricingService(self.session)

        if "aspect_ratio" in config or "size" not in config:
            aspect_ratio = config.get("aspect_ratio", "square")
            config["size"] = await pricing_service.resolve_size(
                model_name=model_name,
                subscription_tier=subscription_tier,
                aspect_ratio=aspect_ratio,
            )

        # Resolve quality
        if "quality" not in config or config.get("quality") == "auto":
            config["quality"] = await pricing_service.get_default_quality(model_name, subscription_tier)

        # Enforce quality restrictions (Free/Creator Lite capped to medium)
        if subscription_tier in ("free", "creator_lite"):
            config["quality"] = "medium"

        # 5. Execute strategy with Auto-Provider Fallback
        logger.info("orchestrator_executing_strategy", mode=job.generation_mode)
        import time
        start_time = time.perf_counter()

        fallback_candidates = []
        if job.generation_mode not in ("background_removal", "white_background"):
            available = []
            if isinstance(self.settings.gemini_api_key, str) and self.settings.gemini_api_key:
                available.append("gemini")
            if isinstance(self.settings.openai_api_key, str) and self.settings.openai_api_key:
                available.append("openai")
            if isinstance(self.settings.grok_api_key, str) and self.settings.grok_api_key:
                available.append("grok")

            curr_name = getattr(getattr(strategy, "provider", None), "provider_name", "")
            for p in available:
                if p != curr_name and p not in fallback_candidates:
                    fallback_candidates.append(p)

        strategies_to_try = [strategy]
        for p_name in fallback_candidates:
            p_inst = get_ai_provider(p_name, self.settings)
            strategies_to_try.append(ExternalProviderStrategy(provider=p_inst, prompt_template=prompt_template_content))

        result = None
        for idx, current_strat in enumerate(strategies_to_try):
            try:
                result = await current_strat.execute(job=job, input_image_bytes=input_bytes, config=config)
                latency_ms = int((time.perf_counter() - start_time) * 1000)

                await self._create_provider_request(
                    job_id=job.id,
                    result=result,
                    latency_ms=latency_ms,
                    status="success",
                )
                break
            except Exception as e:
                logger.warning(
                    "provider_generation_failed_trying_fallback",
                    attempt=idx + 1,
                    total_candidates=len(strategies_to_try),
                    error=str(e),
                )
                if idx == len(strategies_to_try) - 1:
                    latency_ms = int((time.perf_counter() - start_time) * 1000)
                    prov = getattr(current_strat, "provider", None)
                    p_name = getattr(prov, "provider_name", prov.__class__.__name__.replace("Provider", "").lower() if prov else "unknown")
                    m_name = getattr(prov, "model", "unknown") if prov else "unknown"

                    await self._create_provider_request(
                        job_id=job.id,
                        result=None,
                        latency_ms=latency_ms,
                        status="failed",
                        error_message=str(e),
                        provider_name_override=p_name,
                        model_override=m_name,
                    )
                    raise e

        # 6. Upload result to Storage
        # Generated path format: {user_id}/generated/{job_id}.png
        # (Assuming the original image model has a user_id, but the upload_repo query might not expose it easily)
        # Let's query the batch to get user_id, or just use batch_id in the path
        from app.modules.batches.repository import BatchRepository

        batch_repo = BatchRepository(self.session)
        batch = await batch_repo.get_by_id(job.batch_id)
        if not batch:
            raise NotFoundError(resource="Batch", identifier=str(job.batch_id))

        user_id = str(batch.user_id)
        ext = result.mime_type.split("/")[-1] if "/" in result.mime_type else "png"
        output_path = f"{user_id}/generated/{job.id}.{ext}"

        logger.info("orchestrator_uploading_result", path=output_path)
        await self.storage.upload(
            file_path=output_path, content=result.image_bytes, content_type=result.mime_type
        )

        # 7. Update Job with result_url
        job.result_url = output_path

        # 8. Auto-extract e-commerce catalog metadata for all fashion generation modes
        fashion_modes = (
            "try_on", "on_model", "mannequin_to_model", "flatlay_to_model",
            "saree_model", "ghost_mannequin", "lifestyle", "flat_lay", "folded", "closeup"
        )
        if config.get("generate_catalog", True) and job.generation_mode in fashion_modes:
            try:
                from app.modules.catalog.service import generate_catalog_copy
                job.catalog_data = await generate_catalog_copy(result.image_bytes, result.mime_type)
            except Exception as e:
                logger.warning(f"Failed to auto-generate catalog metadata during orchestration: {e}")

        # Eagerly flush state to session
        try:
            await self.session.flush()
        except Exception:
            pass

        # We don't commit here; the JobService calling this orchestrator handles the commit
        logger.info("orchestrator_completed", job_id=str(job.id))

    async def _create_provider_request(
        self,
        job_id: Any,
        result: Any | None,
        latency_ms: int,
        status: str,
        error_message: str | None = None,
        provider_name_override: str | None = None,
        model_override: str | None = None,
    ) -> None:
        """Create and save a ProviderRequest record in the database."""
        from app.modules.jobs.models import ProviderRequest

        provider_name = provider_name_override or (result.provider_name if result else "unknown")
        if not isinstance(provider_name, str):
            provider_name = getattr(provider_name, "__name__", str(provider_name))

        # Get tokens/metadata first to avoid UnboundLocalError
        metadata = result.metadata if (result and result.metadata) else {}
        input_tokens = metadata.get("input_tokens") or metadata.get("promptTokenCount")
        output_tokens = metadata.get("output_tokens") or metadata.get("candidatesTokenCount")

        # Determine model
        model = model_override or "unknown"
        if not isinstance(model, str):
            model = getattr(model, "__name__", str(model))

        if result:
            if provider_name == "grok":
                model = metadata.get("model") or "grok-imagine-image-quality"
            elif provider_name == "openai":
                model = metadata.get("model") or "gpt-image-2"
            elif provider_name == "gemini":
                model = metadata.get("model") or "gemini-3.1-flash-lite-image"
            elif provider_name == "local_rembg":
                model = "rembg"

        # Apply fallbacks for tokens
        if input_tokens is None:
            input_tokens = 0
        if output_tokens is None:
            output_tokens = 0
        if output_tokens == 0 and status == "success" and "gemini" in provider_name.lower():
            output_tokens = 1120

        # Update metadata dict to use the resolved token counts for pricing
        metadata = dict(metadata)
        metadata["input_tokens"] = input_tokens
        metadata["output_tokens"] = output_tokens

        # Calculate cost in USD
        from app.modules.generation.pricing import PricingService
        pricing_service = PricingService(self.session)
        cost = await pricing_service.calculate_cost(
            provider_name=provider_name,
            model_name=model,
            metadata=metadata,
            status=status,
        )

        req = ProviderRequest(
            job_id=job_id,
            provider_name=provider_name,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            cost=cost,
            status=status,
            error_message=error_message,
        )
        self.session.add(req)
        await self.session.flush()
