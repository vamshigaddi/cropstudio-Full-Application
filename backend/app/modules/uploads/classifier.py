"""Garment classification service for auto-gender & apparel routing."""

import json
import logging
import base64
from typing import Any, Dict, List
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

CLASSIFICATION_PROMPT = """Analyze this e-commerce product image and classify its taxonomy for an e-commerce catalog.
Determine accurately whether it is wearable apparel (clothing) or a non-clothing element (such as shoes, watches, bags, jewelry, electronics, cosmetics, or documents).

Respond ONLY with a valid JSON object matching this schema:
{
  "is_apparel": true | false,
  "category_type": "apparel" | "footwear" | "accessory" | "non_apparel",
  "gender": "female" | "male" | "unisex" | "kids_female" | "kids_male" | "kids" | "not_applicable",
  "garment_type": "saree" | "kurta_set" | "lehenga" | "dress" | "western_top" | "shirt" | "t_shirt" | "suit" | "trousers" | "jeans" | "hoodie" | "jacket" | "ethnic_bottom" | "activewear" | "shoes" | "watch" | "bag" | "jewelry" | "electronics" | "other",
  "display_name": "Short human-readable garment or item name e.g. Silk Saree, Linen Casual Shirt, Girl's Frock, Boy's Polo, Men's Wrist Watch, or Running Shoes",
  "primary_color": "Dominant color e.g. Emerald Green, Navy Blue, Black, or Multi",
  "pattern": "Solid | Floral | Embroidered | Striped | Printed | Checkered | Zari Work | Not Applicable",
  "recommended_model_gender": "female" | "male" | "kids_female" | "kids_male" | "kids" | null,
  "recommended_ratio": "3:4" | "1:1" | "9:16",
  "confidence": 0.95,
  "warning_message": "Explain warning if non-apparel e.g. 'Non-clothing item detected (watch). AI Model Try-On requires wearable clothing. Use Product Photo / Background Removal instead.' or null if valid apparel"
}
"""

async def classify_single_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> Dict[str, Any]:
    """Classifies a single garment image for gender, garment category, non-clothing guardrails, and model routing."""
    # 1. Try Gemini Vision with fast model fallback
    gemini_key = settings.gemini_api_key or getattr(settings, "GEMINI_API_KEY", "")
    if gemini_key:
        b64_data = base64.b64encode(image_bytes).decode('utf-8')
        gemini_models = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
        
        for model_name in gemini_models:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                payload = {
                    "contents": [
                        {
                            "parts": [
                                {"text": CLASSIFICATION_PROMPT},
                                {
                                    "inlineData": {
                                        "mimeType": mime_type,
                                        "data": b64_data
                                    }
                                }
                            ]
                        }
                    ],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "temperature": 0.1
                    }
                }
                
                async with httpx.AsyncClient(timeout=12.0) as client:
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        data = res.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "{}")
                            parsed = json.loads(raw_text)
                            # Ensure is_apparel boolean exists
                            if "is_apparel" not in parsed:
                                parsed["is_apparel"] = parsed.get("category_type", "apparel") == "apparel"
                            return parsed
                    else:
                        logger.warning(f"Gemini {model_name} returned status {res.status_code}: {res.text[:150]}")
            except Exception as e:
                logger.warning(f"Gemini {model_name} classification error: {e}")

    # 2. Try OpenAI GPT-4o-mini Vision Fallback
    openai_key = settings.openai_api_key or getattr(settings, "OPENAI_API_KEY", "")
    if openai_key and openai_key.startswith("sk-"):
        try:
            b64_data = base64.b64encode(image_bytes).decode('utf-8')
            headers = {
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": CLASSIFICATION_PROMPT},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_data}"}}
                        ]
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1
            }
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    raw_text = data["choices"][0]["message"]["content"]
                    parsed = json.loads(raw_text)
                    if "is_apparel" not in parsed:
                        parsed["is_apparel"] = parsed.get("category_type", "apparel") == "apparel"
                    return parsed
        except Exception as e:
            logger.warning(f"OpenAI garment classification error: {e}")

    # Rule-Based Fallback
    return {
        "is_apparel": True,
        "category_type": "apparel",
        "gender": "female",
        "garment_type": "apparel",
        "display_name": "Garment Product",
        "primary_color": "Multi",
        "pattern": "Solid",
        "recommended_model_gender": "female",
        "recommended_ratio": "3:4",
        "confidence": 0.5,
        "warning_message": None
    }
