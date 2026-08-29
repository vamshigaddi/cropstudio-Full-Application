from app.core.config import Settings
from app.integrations.ai.base import AIProvider
from app.integrations.ai.gemini import GeminiProvider
from app.integrations.ai.grok import GrokProvider
from app.integrations.ai.mock import MockAIProvider
from app.integrations.ai.openai import OpenAIProvider


def get_ai_provider(provider_name: str, settings: Settings) -> AIProvider:
    """Factory to return the requested AI provider."""

    if provider_name == "gemini":
        return GeminiProvider(api_key=settings.gemini_api_key)
    elif provider_name == "openai":
        return OpenAIProvider(api_key=settings.openai_api_key)
    elif provider_name == "grok":
        return GrokProvider(api_key=settings.grok_api_key)

    # Default to mock provider for local development/testing
    return MockAIProvider(provider_name=provider_name)
