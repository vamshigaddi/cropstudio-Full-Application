import hashlib
import hmac
from typing import Any

import httpx

from app.core.config import Settings
from app.core.exceptions import ProviderError


class RazorpayClient:
    """Razorpay payment gateway API client wrapper."""

    def __init__(self, settings: Settings) -> None:
        self.key_id = settings.razorpay_key_id
        self.key_secret = settings.razorpay_key_secret

    async def create_order(self, amount_in_paise: int, receipt: str) -> dict[str, Any]:
        """Create a Razorpay order via REST API.

        If API keys are not configured, it will simulate/mock order creation for testing.
        """
        if not self.key_id or not self.key_secret:
            # Mock mode
            import uuid

            return {
                "id": f"order_mock_{uuid.uuid4().hex[:12]}",
                "entity": "order",
                "amount": amount_in_paise,
                "amount_paid": 0,
                "amount_due": amount_in_paise,
                "currency": "INR",
                "receipt": receipt,
                "status": "created",
                "attempts": 0,
                "notes": {},
                "created_at": 1672531200,
                "mock": True,
            }

        url = "https://api.razorpay.com/v1/orders"
        auth = (self.key_id, self.key_secret)
        payload = {
            "amount": amount_in_paise,
            "currency": "INR",
            "receipt": receipt,
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload, auth=auth, timeout=10.0)
                if response.status_code != 200:
                    raise ProviderError(
                        provider="Razorpay",
                        message=f"Failed to create order: {response.text}",
                    )
                data: dict[str, Any] = response.json()
                return data
            except Exception as e:
                if isinstance(e, ProviderError):
                    raise
                raise ProviderError(provider="Razorpay", message=f"Network error: {e!s}") from e

    def verify_payment_signature(self, order_id: str, payment_id: str, signature: str) -> bool:
        """Verify Razorpay payment signature."""
        if not self.key_id or not self.key_secret or order_id.startswith("order_mock_"):
            # Mock verification
            return signature == "mock_signature_approved"

        msg = f"{order_id}|{payment_id}"
        computed = hmac.new(
            self.key_secret.encode("utf-8"),
            msg.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(computed, signature)

    def verify_webhook_signature(self, body_bytes: bytes, signature: str, secret: str | None = None) -> bool:
        """Verify Razorpay webhook signature."""
        webhook_secret = secret or self.key_secret
        if not webhook_secret or not self.key_id:
            # Mock mode or local development
            return True

        computed = hmac.new(
            webhook_secret.encode("utf-8"),
            body_bytes,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(computed, signature)

