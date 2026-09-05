"""Catalog Intelligence Service — Generates SEO Titles, Descriptions, Bullets, and CSV sheets."""

import json
import logging
import base64
import csv
import io
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

CATALOG_SYSTEM_PROMPT = """You are a senior fashion e-commerce catalog specialist for Amazon, Myntra, Flipkart, Meesho, and Shopify.
Analyze this apparel product image and generate complete, high-converting catalog copywriting and structured product specifications.

Follow Amazon & Myntra's strict guidelines:
- Title must follow the standard e-commerce formula: [Gender/Target] + [Fabric/Material] + [Work/Pattern] + [Garment Type] + [Key Detail / Sleeves / Neck] + [Occasion]
- Provide 5 distinct, high-impact bullet points covering:
  1. Material & Breathability
  2. Design & Surface Ornamentation (Embroidery / Prints / Buttons)
  3. Fit & Cut Silhouette
  4. Styling & Features (Neckline, Sleeve length, Pockets)
  5. Occasion & Care Instructions
- Extract specific attributes (fabric, color, occasion, fit_type, pattern).

Respond ONLY with a JSON object strictly matching this schema:
{
  "title": "String (80-140 characters, high-ranking SEO marketplace title)",
  "short_description": "String (2-3 sentences highlighting comfort, premium feel, styling advice)",
  "bullets": [
    "Fabric & Material: ...",
    "Design & Styling: ...",
    "Fit & Silhouette: ...",
    "Details & Features: ...",
    "Occasion & Care: ..."
  ],
  "attributes": {
    "category": "e.g. Women Ethnic Wear or Men Formal Wear",
    "sub_category": "e.g. Kurta Sets or Casual Shirts",
    "color": "e.g. Mustard Yellow",
    "pattern": "e.g. Floral Embroidered",
    "fabric": "e.g. Pure Cotton or Chanderi Silk",
    "fit_type": "e.g. Regular Fit or Slim Fit",
    "neck_style": "e.g. Round Neck or Mandarin Collar",
    "sleeve_type": "e.g. 3/4th Sleeves or Full Sleeves",
    "occasion": "e.g. Festive, Casual, Party, Wedding"
  },
  "search_keywords": ["keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"]
}
"""

async def generate_catalog_copy(image_bytes: bytes, mime_type: str = "image/jpeg", user_brand_name: str = "CropStudio") -> Dict[str, Any]:
    """Generates structured catalog titles, bullets, descriptions, and attributes from an image."""
    b64_data = base64.b64encode(image_bytes).decode('utf-8')
    
    # 1. Try Gemini Vision with multi-model fallback
    gemini_key = settings.gemini_api_key or getattr(settings, "GEMINI_API_KEY", "")
    if gemini_key:
        gemini_models = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
        for model_name in gemini_models:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
                payload = {
                    "contents": [
                        {
                            "parts": [
                                {"text": CATALOG_SYSTEM_PROMPT},
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
                        "temperature": 0.2
                    }
                }
                async with httpx.AsyncClient(timeout=18.0) as client:
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        data = res.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "{}")
                            return json.loads(raw_text)
                    else:
                        logger.warning(f"Gemini {model_name} catalog returned {res.status_code}: {res.text[:150]}")
            except Exception as e:
                logger.warning(f"Gemini {model_name} catalog generation error: {e}")

    # 2. Try OpenAI GPT-4o-mini Vision Fallback
    openai_key = settings.openai_api_key or getattr(settings, "OPENAI_API_KEY", "")
    if openai_key and openai_key.startswith("sk-"):
        try:
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
                            {"type": "text", "text": CATALOG_SYSTEM_PROMPT},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_data}"}}
                        ]
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.2
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    raw_text = data["choices"][0]["message"]["content"]
                    return json.loads(raw_text)
        except Exception as e:
            logger.warning(f"OpenAI catalog generation error: {e}")

    # Fallback template
    return {
        "title": "Premium Fashion Apparel Product for Men & Women",
        "short_description": "Crafted from breathable, high-grade fabrics designed for everyday elegance, comfort, and durability.",
        "bullets": [
            "Fabric & Material: High-quality breathable blend for all-day comfort",
            "Design & Style: Modern silhouette designed for contemporary fashion aesthetics",
            "Fit & Feel: Tailored regular fit offering maximum ease of movement",
            "Details: Precision stitched seams and refined finishing touches",
            "Care Instructions: Machine wash cold with like colors, tumble dry low"
        ],
        "attributes": {
            "category": "Apparel",
            "sub_category": "Clothing",
            "color": "Multi",
            "pattern": "Solid",
            "fabric": "Cotton Blend",
            "fit_type": "Regular Fit",
            "occasion": "Casual / Daily"
        },
        "search_keywords": ["fashion clothing", "apparel online", "stylish outfit"]
    }

def generate_csv_catalog_stream(items: List[Dict[str, Any]]) -> str:
    """Generates an Amazon/Shopify/Meesho compatible CSV string from catalog data items."""
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Standard E-Commerce Marketplace CSV Header
    headers = [
        "Generated Image File",
        "Visual Mode",
        "Original Upload File",
        "Product Title",
        "Category",
        "Sub-Category",
        "Color",
        "Fabric",
        "Pattern",
        "Fit Type",
        "Occasion",
        "Bullet 1 (Material)",
        "Bullet 2 (Design)",
        "Bullet 3 (Fit)",
        "Bullet 4 (Details)",
        "Bullet 5 (Care)",
        "Product Description",
        "Search Keywords"
    ]
    writer.writerow(headers)
    
    for item in items:
        cat = item.get("catalog_data") or {}
        attrs = cat.get("attributes") or {}
        bullets = cat.get("bullets") or []
        
        b1 = bullets[0] if len(bullets) > 0 else ""
        b2 = bullets[1] if len(bullets) > 1 else ""
        b3 = bullets[2] if len(bullets) > 2 else ""
        b4 = bullets[3] if len(bullets) > 3 else ""
        b5 = bullets[4] if len(bullets) > 4 else ""
        
        keywords_str = ", ".join(cat.get("search_keywords", []))
        
        writer.writerow([
            item.get("generated_filename", item.get("filename", "image.png")),
            item.get("mode", "AI Enhanced"),
            item.get("original_filename", item.get("filename", "upload.jpg")),
            cat.get("title", ""),
            attrs.get("category", ""),
            attrs.get("sub_category", ""),
            attrs.get("color", ""),
            attrs.get("fabric", ""),
            attrs.get("pattern", ""),
            attrs.get("fit_type", ""),
            attrs.get("occasion", ""),
            b1,
            b2,
            b3,
            b4,
            b5,
            cat.get("short_description", ""),
            keywords_str
        ])
        
    return output.getvalue()
