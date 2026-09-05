"""AI Integrations — Gemini Provider."""

import base64
from typing import Any

import httpx

from app.core.exceptions import ProviderError
from app.core.logging import get_logger
from app.integrations.ai.base import AIProvider, GenerationResult

logger = get_logger(__name__)


class GeminiProvider(AIProvider):
    """Google Gemini API provider using the `gemini-3.1-flash-lite-image` model.

    Communicates directly with Google's REST API using httpx.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        if not api_key:
            logger.warning("gemini_api_key_missing")
        self.model = "gemini-3.1-flash-lite-image"
        self.url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        )

    async def generate(
        self,
        prompt: str,
        image_bytes: bytes | None,
        config: dict[str, Any],
    ) -> GenerationResult:
        """Call Google's Gemini generateContent API to create or edit an image."""
        if not self.api_key:
            raise ProviderError(
                provider="Gemini",
                message="Gemini API Key is not configured. Please set GEMINI_API_KEY in your environment.",
            )

        fashion_tryon_modes = ("try_on", "on_model", "mannequin_to_model", "flatlay_to_model", "saree_model", "lifestyle")
        gen_mode = config.get("generation_mode")
        is_tryon_mode = (gen_mode in fashion_tryon_modes) if gen_mode else bool(config.get("model_image_base64"))
        has_model_img = is_tryon_mode and bool(config.get("model_image_base64"))

        if gen_mode == "lifestyle" and has_model_img:
            prompt = (
                "You are an elite high-end editorial fashion photographer. "
                "Analyze the garment in the first image and the fashion model person in the second image. "
                "Dress the model person in the exact garment and photograph them in a realistic, sophisticated commercial lifestyle setting following these strict rules:\n"
                "1. PRESERVE MODEL IDENTITY: Maintain the exact face, facial features, hair, skin tone, and body proportions of the model person in the reference image.\n"
                "2. AUTHENTIC PHOTOGRAPHIC REALISM: The image must look like an authentic, professional editorial photograph shot on an 85mm f/1.4 portrait camera lens with natural soft daylight. "
                "Render realistic skin texture with natural skin pores, realistic hair strands, and authentic subtle skin undertones. "
                "Strictly avoid any artificial AI smoothness, plastic skin, CGI sheen, glowing halos, or cartoon saturation.\n"
                "3. TASTEFUL MODERN BACKDROP: Place the model in a contemporary, stylish, understated urban lifestyle setting (e.g. minimalist cafe terrace, modern architectural loft patio, contemporary city avenue, clean natural stone sidewalk with soft natural depth of field bokeh). "
                "Do NOT generate fantasy illustrations, oversaturated neon flowers, or fake props (no fake cameras in hand).\n"
                "4. EXACT GARMENT PRESERVATION & DRAPE: Preserve the exact color, fabric weave, graphic prints, and fit of the garment. Natural realistic cloth drape with subtle folds and authentic shadows.\n"
                "5. NATURAL NECK & COLLAR: The neck passes naturally through the collar with clean skin, without duplicate inner tags or inner collar rings on the chest.\n"
                f"Scene Details: {prompt}"
            )
        elif has_model_img:
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
        elif gen_mode == "folded":
            prompt = (
                "You are an expert commercial e-commerce fashion photographer. "
                "Take the exact apparel garment from the input image and photograph it neatly folded into a clean, crisp retail fold resting on a minimalist, elegant surface. "
                "Preserve the exact garment color, graphics, prints, fabric texture, and details. "
                "Do NOT include any human model, mannequin, face, or person in this photo. Pure folded product photography. "
                f"Scene Details: {prompt}"
            )
        elif gen_mode == "flat_lay":
            prompt = (
                "You are an expert commercial e-commerce fashion photographer. "
                "Take the exact apparel garment from the input image and photograph it neatly arranged in a flat lay top-down composition on an aesthetic surface. "
                "Preserve the exact garment color, fabric texture, prints, and details. "
                "Do NOT include any human model, mannequin, or person in this photo. "
                f"Scene Details: {prompt}"
            )
        elif gen_mode == "ghost_mannequin":
            prompt = (
                "You are an expert commercial e-commerce fashion photographer. "
                "Generate a 3D ghost mannequin product shot of the garment from the input image on a pure white studio background. "
                "The garment should have a hollow, three-dimensional fitted shape with the inner collar naturally visible, as if worn by an invisible mannequin. "
                "Do NOT include any human head, limbs, face, or skin. Pure ghost mannequin product photograph. "
                f"Scene Details: {prompt}"
            )
        elif gen_mode == "closeup":
            prompt = (
                "You are an expert macro commercial photographer. "
                "Generate a macro closeup shot focusing on the fine fabric texture, weave, stitching details, and material quality of this garment. "
                "Do NOT include any human model or face. "
                f"Scene Details: {prompt}"
            )

        # 1. Build parts list
        parts: list[dict[str, Any]] = [{"text": prompt}]

        if image_bytes:
            # Base64 encode the input image
            encoded_image = base64.b64encode(image_bytes).decode("utf-8")
            # Default or detect input mime type (default to image/png or image/jpeg)
            input_mime = config.get("input_mime_type", "image/png")
            parts.append(
                {
                    "inlineData": {
                        "mimeType": input_mime,
                        "data": encoded_image,
                    }
                }
            )

        if has_model_img:
            parts.append(
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": config["model_image_base64"],
                    }
                }
            )

        ratio_map = {
            "square": "1:1",
            "landscape": "16:9",
            "portrait": "9:16"
        }
        aspect_ratio_raw = str(config.get("aspect_ratio", "square")).lower()
        aspect_ratio_val = aspect_ratio_raw if ":" in aspect_ratio_raw else ratio_map.get(aspect_ratio_raw, "1:1")

        size = config.get("size", "1024x1024")
        if "3840" in size or "2160" in size:
            image_size_val = "4K"
        elif "2048" in size:
            image_size_val = "2K"
        else:
            image_size_val = "1K"

        # Determine target model dynamically
        model_name = "gemini-3.1-flash-image" if (image_size_val in ("2K", "4K")) else "gemini-3.1-flash-lite-image"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"

        gen_config: dict[str, Any] = {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio_val,
                "imageSize": image_size_val,
            }
        }
        resp_mime = config.get("response_mime_type")
        if resp_mime and not resp_mime.startswith("image/"):
            gen_config["responseMimeType"] = resp_mime

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": gen_config,
        }

        # 2. Make the HTTP request
        logger.info(
            "gemini_api_request",
            model=model_name,
            prompt=prompt,
            has_image=image_bytes is not None,
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    url,
                    params={"key": self.api_key},
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
            except httpx.RequestError as e:
                logger.error("gemini_api_network_error", error=str(e))
                raise ProviderError(
                    provider="Gemini",
                    message=f"Network error communicating with Gemini API: {e!s}",
                ) from e

        # 3. Parse response
        if response.status_code != 200:
            logger.error(
                "gemini_api_error_response",
                status_code=response.status_code,
                body=response.text,
            )
            raise ProviderError(
                provider="Gemini",
                message=f"Gemini API returned status code {response.status_code}: {response.text}",
            )

        try:
            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise ProviderError(
                    provider="Gemini",
                    message="No candidates returned from Gemini API response.",
                )

            first_candidate = candidates[0]
            content = first_candidate.get("content", {})
            response_parts = content.get("parts", [])
            if not response_parts:
                raise ProviderError(
                    provider="Gemini",
                    message="No parts found in the first candidate of the Gemini response.",
                )

            # Find the part containing inlineData
            image_part = next((p for p in response_parts if "inlineData" in p), None)
            if not image_part:
                # If there's no inlineData, check if there's text (which might contain error messages or safety blocks)
                text_part = next((p for p in response_parts if "text" in p), None)
                err_msg = text_part["text"] if text_part else "No image data returned."
                raise ProviderError(
                    provider="Gemini",
                    message=f"Gemini API did not return an image. Response text: {err_msg}",
                )

            inline_data = image_part["inlineData"]
            mime_type = inline_data.get("mimeType", "image/png")
            base64_data = inline_data.get("data", "")

            if not base64_data:
                raise ProviderError(
                    provider="Gemini",
                    message="Gemini API returned an empty inlineData image block.",
                )

            # Decode base64 to bytes
            generated_bytes = base64.b64decode(base64_data)

            # Gather cost metrics if available (e.g. from usageMetadata)
            usage = data.get("usageMetadata", {})
            metadata = {
                "model": model_name,
                "input_tokens": usage.get("promptTokenCount", 0),
                "output_tokens": usage.get("candidatesTokenCount", 0),
                "total_tokens": usage.get("totalTokenCount", 0),
            }

            return GenerationResult(
                image_bytes=generated_bytes,
                mime_type=mime_type,
                metadata=metadata,
                provider_name="gemini",
            )

        except (KeyError, ValueError, IndexError) as e:
            logger.error("gemini_api_parse_error", error=str(e), body=response.text)
            raise ProviderError(
                provider="Gemini",
                message=f"Failed to parse Gemini API response payload: {e!s}",
            ) from e
