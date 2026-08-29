"""AI Integrations — OpenAI Provider."""

import base64
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from app.core.exceptions import ProviderError
from app.core.logging import get_logger
from app.integrations.ai.base import AIProvider, GenerationResult

logger = get_logger(__name__)


class OpenAIProvider(AIProvider):
    """OpenAI API provider using the `gpt-image-2` model.

    Utilizes the official `openai` SDK for async operations.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        if not api_key:
            logger.warning("openai_api_key_missing")
        self.model = "gpt-image-2"

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Call OpenAI's image generation API to create an image."""
        if not self.api_key:
            raise ProviderError(
                provider="OpenAI",
                message="OpenAI API Key is not configured. Please set OPENAI_API_KEY in your environment.",
            )

        has_model_img = "model_image_base64" in config and config["model_image_base64"]

        if image_bytes is not None or has_model_img:
            # Call OpenAI Responses API (Image-to-Image / Reference Image Generation)
            client = AsyncOpenAI(api_key=self.api_key)
            
            # Form try-on prompt if model image is present
            if has_model_img:
                prompt = (
                    "You are an expert fashion virtual try-on AI specialist. "
                    "Analyze the garment in the first image and the model person in the second image. "
                    "Accurately dress the model person in the exact garment while following these strict rules:\n"
                    "1. PRESERVE MODEL IDENTITY: Keep the exact same face, hair, eyes, facial structure, skin tone, and body shape of the model person.\n"
                    "2. NATURAL NECKLINE & COLLAR FIT: Fit the front collar of the garment naturally around the model's neck. "
                    "If the garment reference image shows the inside back of the collar, size label, or inner brand tag, DO NOT draw or duplicate that inner back tag or inner back neck ring on the model's neck or chest. "
                    "The human neck must pass cleanly through the shirt collar, naturally occluding the inner back of the garment as in real life.\n"
                    "3. ACCURATE DRAPE: Draping and fabric texture must realistically follow the shoulders, chest, and arms with natural folds and lighting.\n"
                    "4. CLEAN SKIN: The model's neck, clavicle, and throat area must be clean, natural human skin without floating tags, text, or double collar rings.\n"
                    f"Style / Scene Prompt: {prompt}"
                )

            # Build content parts
            content_parts = [{"type": "input_text", "text": prompt}]

            if image_bytes is not None:
                b64_garment = base64.b64encode(image_bytes).decode("utf-8")
                content_parts.append({
                    "type": "input_image",
                    "image_url": f"data:image/png;base64,{b64_garment}",
                })

            if has_model_img:
                content_parts.append({
                    "type": "input_image",
                    "image_url": f"data:image/png;base64,{config['model_image_base64']}",
                })

            logger.info(
                "openai_responses_api_request",
                model=self.model,
                prompt=prompt,
                has_image=image_bytes is not None,
                has_model_image=bool(has_model_img),
            )

            api_model = "gpt-5.6" if self.model == "gpt-image-2" else self.model
            tool_config: dict[str, Any] = {"type": "image_generation"}
            if "size" in config:
                tool_config["size"] = config["size"]
            if "quality" in config:
                tool_config["quality"] = config["quality"]

            try:
                response = await client.responses.create(
                    model=api_model,
                    input=[
                        {
                            "role": "user",
                            "content": content_parts,
                        }
                    ],
                    tools=[tool_config],
                )
            except OpenAIError as e:
                logger.error("openai_responses_api_error", error=str(e))
                raise ProviderError(
                    provider="OpenAI",
                    message=f"OpenAI Responses API call failed: {e!s}",
                ) from e

            # Parse image from responses output
            image_base64 = None
            try:
                for output in response.output:
                    output_type = getattr(output, "type", None)
                    if output_type == "image_generation_call":
                        image_base64 = getattr(output, "result", None)
                        if image_base64:
                            break

                if not image_base64:
                    output_text = getattr(response, "output_text", "")
                    if not output_text:
                        for output in response.output:
                            if getattr(output, "type", None) == "text":
                                output_text = getattr(output, "text", "")
                                break
                    raise ProviderError(
                        provider="OpenAI",
                        message=f"OpenAI Responses API did not generate an image. Response text: {output_text}",
                    )

                usage = getattr(response, "usage", None)
                input_tokens = 0
                output_tokens = 0
                input_tokens_details = {}
                if usage:
                    input_tokens = getattr(usage, "input_tokens", 0) or 0
                    output_tokens = getattr(usage, "output_tokens", 0) or 0
                    details_obj = getattr(usage, "input_tokens_details", None)
                    if details_obj:
                        if hasattr(details_obj, "get"):
                            input_tokens_details = {
                                "text_tokens": details_obj.get("text_tokens", 0),
                                "image_tokens": details_obj.get("image_tokens", 0),
                                "cached_tokens": details_obj.get("cached_tokens", 0),
                                "cache_write_tokens": details_obj.get("cache_write_tokens", 0),
                            }
                        else:
                            input_tokens_details = {
                                "text_tokens": getattr(details_obj, "text_tokens", 0) or 0,
                                "image_tokens": getattr(details_obj, "image_tokens", 0) or 0,
                                "cached_tokens": getattr(details_obj, "cached_tokens", 0) or 0,
                                "cache_write_tokens": getattr(details_obj, "cache_write_tokens", 0) or 0,
                            }

                decoded_bytes = base64.b64decode(image_base64)
                mime_type = f"image/{config.get('format', 'png')}"
                metadata = {
                    "model": self.model,
                    "tool": "image_generation",
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "input_tokens_details": input_tokens_details,
                    "size": config.get("size", "1024x1024"),
                    "quality": config.get("quality", "medium"),
                }

                return GenerationResult(
                    image_bytes=decoded_bytes,
                    mime_type=mime_type,
                    metadata=metadata,
                    provider_name="openai",
                )

            except (IndexError, AttributeError, ValueError) as e:
                logger.error("openai_responses_parse_error", error=str(e))
                raise ProviderError(
                    provider="OpenAI",
                    message=f"Failed to parse OpenAI Responses API payload: {e!s}",
                ) from e

        # 1. Prepare parameters
        size = config.get("size", "1024x1024")
        params: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "response_format": "b64_json",
            "size": size,
        }

        # Handle custom parameter additions (quality, compression, format, background)
        extra_body: dict[str, Any] = {}
        if "quality" in config:
            extra_body["quality"] = config["quality"]
        if "compression" in config:
            extra_body["compression"] = config["compression"]
        if "format" in config:
            extra_body["format"] = config["format"]
        if "background" in config:
            extra_body["background"] = config["background"]

        if extra_body:
            params["extra_body"] = extra_body

        logger.info(
            "openai_image_generation_request",
            model=self.model,
            prompt=prompt,
            size=size,
            extra_params=extra_body,
        )

        # 2. Call OpenAI Async API
        client = AsyncOpenAI(api_key=self.api_key)
        try:
            response = await client.images.generate(**params)
        except OpenAIError as e:
            logger.error("openai_api_error", error=str(e))
            raise ProviderError(
                provider="OpenAI",
                message=f"OpenAI API call failed: {e!s}",
            ) from e

        # 3. Parse and decode the base64 image data
        try:
            if not response.data or not response.data[0]:
                raise ProviderError(
                    provider="OpenAI",
                    message="OpenAI API returned an empty data list.",
                )

            image_data = response.data[0]
            b64_json = getattr(image_data, "b64_json", None)
            if not b64_json:
                raise ProviderError(
                    provider="OpenAI",
                    message="OpenAI API did not return b64_json data.",
                )

            decoded_bytes = base64.b64decode(b64_json)
            mime_type = f"image/{config.get('format', 'png')}"

            # Assemble metadata (useful for tracing and billing calculation later)
            metadata = {
                "size": size,
                "quality": config.get("quality", "medium"),
            }

            return GenerationResult(
                image_bytes=decoded_bytes,
                mime_type=mime_type,
                metadata=metadata,
                provider_name="openai",
            )

        except (IndexError, AttributeError, ValueError) as e:
            logger.error("openai_parse_error", error=str(e))
            raise ProviderError(
                provider="OpenAI",
                message=f"Failed to parse OpenAI API response payload: {e!s}",
            ) from e
