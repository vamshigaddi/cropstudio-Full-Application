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
        # Call the AI provider
        job_config = dict(config or {})
        job_config["generation_mode"] = job.generation_mode

        fashion_tryon_modes = ("try_on", "on_model", "mannequin_to_model", "flatlay_to_model", "saree_model", "lifestyle")
        is_tryon_mode = job.generation_mode in fashion_tryon_modes

        if not is_tryon_mode:
            # CRITICAL: For non-model product modes (folded, flat_lay, ghost_mannequin, closeup),
            # purge model image and model descriptions so the job is pure product photography!
            job_config.pop("model_image_base64", None)
            job_config["model_image_base64"] = None
            job_config.pop("model_description", None)
        else:
            # 1. Resolve image metadata for this specific model-wearing job
            img_meta = (job_config.get("image_metadata") or {}).get(str(job.image_id), {})
            if img_meta.get("model_image_base64"):
                job_config["model_image_base64"] = img_meta["model_image_base64"]

            # 2. If model_image_base64 is still missing for on-model/try-on modes, load from R2 or collection
            if not job_config.get("model_image_base64"):
                import base64
                import os
                from pathlib import Path
                import httpx

                model_rel = img_meta.get("model")
                if not model_rel:
                    gender = job.detected_gender or ("male" if "male" in job_config.get("model_description", "").lower() else "female")
                    model_rel = f"/images/avatar-{gender}.png" if gender in ("male", "female") else "/images/avatar-female.png"

                model_bytes = None

                # A. If model is a full HTTP / CDN URL (e.g. from Cloudflare R2)
                if model_rel.startswith("http://") or model_rel.startswith("https://"):
                    try:
                        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                            res = await client.get(model_rel)
                            if res.status_code == 200:
                                model_bytes = res.content
                                logger.info("loaded_assigned_model_from_url", url=model_rel, job_id=str(job.id))
                    except Exception as err:
                        logger.warning("failed_fetching_remote_model", error=str(err), url=model_rel)

                # B. If model is a storage key (e.g. models/tanuj_123.jpg)
                if not model_bytes and not model_rel.startswith("/images/"):
                    try:
                        from app.core.config import get_settings
                        from app.integrations.storage.factory import get_storage_provider
                        settings = get_settings()
                        storage = get_storage_provider(settings)
                        model_bytes = await storage.download(model_rel)
                        if model_bytes:
                            logger.info("loaded_assigned_model_from_r2_storage", key=model_rel, job_id=str(job.id))
                    except Exception:
                        pass

                # C. Fallback to local image collection
                if not model_bytes:
                    clean_name = os.path.basename(model_rel)
                    root_dir = Path(__file__).resolve().parents[5]
                    target_path = root_dir / "frontend" / "public" / "images" / clean_name
                    if not target_path.exists():
                        target_path = root_dir / "frontend" / "public" / "images" / "avatar-female.png"

                    if target_path.exists():
                        try:
                            with open(target_path, "rb") as mf:
                                model_bytes = mf.read()
                                logger.info("loaded_assigned_model_from_collection", model_path=str(target_path), job_id=str(job.id))
                        except Exception as err:
                            logger.warning("failed_loading_fallback_model_image", error=str(err), path=str(target_path))

                if model_bytes:
                    job_config["model_image_base64"] = base64.b64encode(model_bytes).decode("utf-8")

            if job.detected_gender and not job_config.get("model_description"):
                gender_label = "female" if job.detected_gender in ("female", "women") else ("male" if job.detected_gender in ("male", "men") else job.detected_gender)
                job_config["model_description"] = f"professional {gender_label} fashion model"

        if job.detected_garment_type and (not job_config.get("clothing_item") or job_config.get("clothing_item") == "clothing"):
            job_config["clothing_item"] = job.detected_garment_type.replace("_", " ")

        # Always build mode-specific prompt using the resolved strategy prompt_template
        prompt = self._build_prompt(job_config) if self.prompt_template else job_config.get("prompt", "")

        result = await self.provider.generate(
            prompt=prompt,
            image_bytes=input_image_bytes,
            config=job_config,
        )

        return result
