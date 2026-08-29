"""AI Integrations — Pricing and Resolution Resolver Service."""

from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.generation.models import ModelPricing
from app.core.logging import get_logger

logger = get_logger(__name__)

# Default pricing and configuration mapping as a fallback if DB is uninitialized
DEFAULT_PRICING_CONFIGS: dict[str, dict[str, Any]] = {
    "gpt-image-2": {
        "provider_name": "openai",
        "pricing_data": {
            "token_rates": {
                "input_image": 8.00 / 1_000_000.0,
                "input_image_cached": 2.00 / 1_000_000.0,
                "input_text": 5.00 / 1_000_000.0,
                "input_text_cached": 1.25 / 1_000_000.0,
                "output_image": 30.00 / 1_000_000.0,
            },
            "legacy_prices": {
                "1024x1024": {
                    "low": 0.006,
                    "medium": 0.053,
                    "high": 0.211,
                },
                "1536x1024": {
                    "low": 0.005,
                    "medium": 0.041,
                    "high": 0.041,
                },
                "1024x1536": {
                    "low": 0.005,
                    "medium": 0.041,
                    "high": 0.041,
                },
                "default": {
                    "low": 0.005,
                    "medium": 0.041,
                    "high": 0.041,
                }
            },
            "resolutions": {
                "enterprise_studio": {
                    "square": "2048x2048",
                    "landscape": "3840x2160",
                    "portrait": "2160x3840",
                },
                "brand_pro": {
                    "square": "2048x2048",
                    "landscape": "3840x2160",
                    "portrait": "2160x3840",
                },
                "creator_lite": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                },
                "free": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                }
            },
            "default_qualities": {
                "enterprise_studio": "high",
                "brand_pro": "high",
                "creator_lite": "medium",
                "free": "medium",
            }
        }
    },
    "gemini-3.1-flash-lite-image": {
        "provider_name": "gemini",
        "pricing_data": {
            "token_rates": {
                "input_token": 0.25 / 1_000_000.0,
                "output_token": 30.00 / 1_000_000.0,
            },
            "resolutions": {
                "creator_lite": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                },
                "free": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                }
            },
            "default_qualities": {
                "creator_lite": "medium",
                "free": "medium",
            }
        }
    },
    "gemini-3.1-flash-image": {
        "provider_name": "gemini",
        "pricing_data": {
            "token_rates": {
                "input_token": 0.50 / 1_000_000.0,
                "output_token": 60.00 / 1_000_000.0,
            },
            "resolutions": {
                "enterprise_studio": {
                    "square": "2048x2048",
                    "landscape": "3840x2160",
                    "portrait": "2160x3840",
                },
                "brand_pro": {
                    "square": "2048x2048",
                    "landscape": "2048x1152",
                    "portrait": "1152x2048",
                },
                "creator_lite": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                },
                "free": {
                    "square": "1024x1024",
                    "landscape": "1536x1024",
                    "portrait": "1024x1536",
                }
            },
            "default_qualities": {
                "enterprise_studio": "high",
                "brand_pro": "high",
                "creator_lite": "medium",
                "free": "medium",
            }
        }
    }
}


class PricingService:
    """Service to handle resolution resolution and pricing dynamically from the database."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_config(self, model_name: str) -> dict[str, Any]:
        """Fetch model configuration from the database, falling back to defaults."""
        try:
            stmt = select(ModelPricing).where(ModelPricing.model_name == model_name)
            res = await self.session.execute(stmt)
            model_pricing = res.scalar_one_or_none()
            if model_pricing:
                return model_pricing.pricing_data
        except Exception as e:
            logger.warning("failed_to_fetch_pricing_from_db", model=model_name, error=str(e))

        # Fallback to static defaults
        if model_name in DEFAULT_PRICING_CONFIGS:
            return DEFAULT_PRICING_CONFIGS[model_name]["pricing_data"]
        # Generic fallback
        return DEFAULT_PRICING_CONFIGS["gpt-image-2"]["pricing_data"]

    async def resolve_size(self, model_name: str, subscription_tier: str, aspect_ratio: str) -> str:
        """Resolve aspect ratio and subscription tier to a specific size string (e.g. 1024x1024)."""
        config = await self.get_config(model_name)
        resolutions = config.get("resolutions", {})
        
        # Normalize tier name
        tier = str(subscription_tier).lower()
        if tier not in resolutions:
            tier = "free"

        tier_resolutions = resolutions.get(tier, {})
        ratio = str(aspect_ratio).lower()
        if ratio not in tier_resolutions:
            ratio = "square"

        resolved_size = tier_resolutions.get(ratio, "1024x1024")
        logger.info(
            "resolved_generation_size",
            model=model_name,
            tier=tier,
            aspect_ratio=ratio,
            size=resolved_size,
        )
        return resolved_size

    async def get_default_quality(self, model_name: str, subscription_tier: str) -> str:
        """Get the default quality setting based on the subscription tier."""
        config = await self.get_config(model_name)
        qualities = config.get("default_qualities", {})
        tier = str(subscription_tier).lower()
        return qualities.get(tier, "medium")

    async def calculate_cost(
        self,
        provider_name: str,
        model_name: str,
        metadata: dict[str, Any],
        status: str,
    ) -> float:
        """Calculate the cost of a request in USD dynamically."""
        p_name = provider_name.lower()

        # If generation failed, cost is 0.0
        if status != "success":
            return 0.0

        config = await self.get_config(model_name)
        token_rates = config.get("token_rates", {})

        # ─── Gemini Cost Calculation ───
        if "gemini" in p_name:
            input_tokens = metadata.get("input_tokens") or 0
            output_tokens = metadata.get("output_tokens") or 0
            # Default fallback for output tokens on success
            if output_tokens == 0:
                size = metadata.get("size", "1024x1024")
                if "3840" in size or "2160" in size:
                    output_tokens = 2520
                elif "2048" in size:
                    output_tokens = 1680
                else:
                    output_tokens = 1120

            is_flash_image = "lite" not in model_name.lower()
            default_in = (0.50 / 1_000_000.0) if is_flash_image else (0.25 / 1_000_000.0)
            default_out = (60.00 / 1_000_000.0) if is_flash_image else (30.00 / 1_000_000.0)

            in_rate = token_rates.get("input_token", default_in)
            out_rate = token_rates.get("output_token", default_out)
            return float((input_tokens * in_rate) + (output_tokens * out_rate))

        # ─── OpenAI Cost Calculation ───
        elif "openai" in p_name:
            input_tokens = metadata.get("input_tokens") or 0
            output_tokens = metadata.get("output_tokens") or 0

            # If token usage is available (from Responses API), perform token-based billing
            if input_tokens > 0 or output_tokens > 0:
                details = metadata.get("input_tokens_details", {})
                
                # Fetch rates
                rate_img = token_rates.get("input_image", 8.00 / 1_000_000.0)
                rate_img_cached = token_rates.get("input_image_cached", 2.00 / 1_000_000.0)
                rate_txt = token_rates.get("input_text", 5.00 / 1_000_000.0)
                rate_txt_cached = token_rates.get("input_text_cached", 1.25 / 1_000_000.0)
                rate_out = token_rates.get("output_image", 30.00 / 1_000_000.0)

                # Distribute input tokens into text and image if details are present
                text_toks = details.get("text_tokens", 0)
                image_toks = details.get("image_tokens", 0)
                cached_toks = details.get("cached_tokens", 0)

                if text_toks == 0 and image_toks == 0:
                    # Fallback if details are missing: assume all input tokens are text
                    text_toks = input_tokens

                # Calculate input cost
                input_cost = 0.0
                if cached_toks > 0:
                    # Apply cached rates
                    input_cost += cached_toks * rate_txt_cached
                    remaining_text = max(0, text_toks - cached_toks)
                    input_cost += remaining_text * rate_txt
                    input_cost += image_toks * rate_img
                else:
                    input_cost += (text_toks * rate_txt) + (image_toks * rate_img)

                output_cost = output_tokens * rate_out
                return float(input_cost + output_cost)

            # Fallback to legacy size/quality table pricing for standard DALL-E calls
            legacy_prices = config.get("legacy_prices", {})
            size = metadata.get("size", "1024x1024")
            quality = str(metadata.get("quality", "medium")).lower()

            size_prices = legacy_prices.get(size, legacy_prices.get("default", {}))
            return float(size_prices.get(quality, 0.041))

        # ─── Grok/Other Cost Calculation ───
        elif "grok" in p_name:
            return float(metadata.get("cost_usd", 0.0))

        return 0.0
