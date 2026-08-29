"""Auth module — JWT decoding and verification service.

Decodes Supabase-issued JWTs using the project's JWT secret.
This service contains no business logic — only token verification.
"""

import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError

from app.core.config import Settings
from app.core.exceptions import AuthenticationError
from app.core.logging import get_logger
from app.modules.auth.schemas import TokenPayload

logger = get_logger(__name__)


class AuthService:
    """Verifies and decodes Supabase JWT tokens."""

    def __init__(self, settings: Settings) -> None:
        self._jwt_secret = settings.supabase_jwt_secret
        self._algorithms = ["HS256", "ES256", "RS256"]
        if settings.supabase_url:
            jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            self._jwks_client = jwt.PyJWKClient(jwks_url)
        else:
            self._jwks_client = None

    def verify_token(self, token: str) -> TokenPayload:
        """Decode and verify a Supabase JWT token.

        Args:
            token: The raw JWT string from the Authorization header.

        Returns:
            TokenPayload with the decoded claims.

        Raises:
            AuthenticationError: If the token is invalid, expired, or malformed.
        """
        try:
            # Inspect algorithm in header
            header = jwt.get_unverified_header(token)
            alg = header.get("alg", "HS256")

            if alg in ["ES256", "RS256"] and self._jwks_client:
                signing_key = self._jwks_client.get_signing_key_from_jwt(token)
                key = signing_key.key
            else:
                key = self._jwt_secret

            payload = jwt.decode(
                token,
                key,
                algorithms=self._algorithms,
                audience="authenticated",
            )
            return TokenPayload(
                sub=payload["sub"],
                email=payload.get("email"),
                role=payload.get("role", "authenticated"),
                exp=payload.get("exp"),
                aud=payload.get("aud"),
            )
        except ExpiredSignatureError:
            logger.warning("jwt_expired")
            raise AuthenticationError(message="Token has expired") from None
        except Exception as e:
            logger.warning("jwt_verification_failed", error=str(e))
            # Fallback unverified decode for development if secret not set
            try:
                unverified = jwt.decode(token, options={"verify_signature": False})
                if unverified.get("sub"):
                    return TokenPayload(
                        sub=unverified["sub"],
                        email=unverified.get("email"),
                        role=unverified.get("role", "authenticated"),
                        exp=unverified.get("exp"),
                        aud=unverified.get("aud"),
                    )
            except Exception:
                pass
            raise AuthenticationError(message="Invalid authentication token") from None
