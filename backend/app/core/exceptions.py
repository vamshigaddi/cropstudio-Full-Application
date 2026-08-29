"""CropStudio AI — Domain Exception Hierarchy.

All domain-specific exceptions inherit from CropStudioError.
The API layer maps these to HTTP status codes via global exception handlers.
Business logic should raise these, NEVER raise HTTPException directly.
"""


class CropStudioError(Exception):
    """Base exception for all CropStudio domain errors."""

    def __init__(self, message: str = "An unexpected error occurred", code: str = "INTERNAL_ERROR"):
        self.message = message
        self.code = code
        super().__init__(self.message)


class NotFoundError(CropStudioError):
    """Raised when a requested resource does not exist."""

    def __init__(self, resource: str = "Resource", identifier: str = ""):
        detail = f"{resource} not found"
        if identifier:
            detail = f"{resource} '{identifier}' not found"
        super().__init__(message=detail, code="NOT_FOUND")


class ValidationError(CropStudioError):
    """Raised when input data fails business validation rules."""

    def __init__(self, message: str = "Validation failed"):
        super().__init__(message=message, code="VALIDATION_ERROR")


class AuthenticationError(CropStudioError):
    """Raised when authentication fails or credentials are invalid."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__(message=message, code="AUTHENTICATION_ERROR")


class AuthorizationError(CropStudioError):
    """Raised when the user lacks permission for the requested action."""

    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(message=message, code="AUTHORIZATION_ERROR")


class QuotaExceededError(CropStudioError):
    """Raised when a user exceeds their subscription quota."""

    def __init__(self, message: str = "Quota exceeded"):
        super().__init__(message=message, code="QUOTA_EXCEEDED")


class ProviderError(CropStudioError):
    """Raised when an external AI provider fails."""

    def __init__(self, provider: str, message: str = "Provider request failed"):
        self.provider = provider
        super().__init__(message=f"[{provider}] {message}", code="PROVIDER_ERROR")


class ProviderUnavailableError(ProviderError):
    """Raised when all providers are unavailable (circuit breaker open)."""

    def __init__(self, message: str = "All providers are currently unavailable"):
        super().__init__(provider="ALL", message=message)


class InvalidStateTransitionError(CropStudioError):
    """Raised when a job state transition is not allowed."""

    def __init__(self, current_state: str, target_state: str):
        super().__init__(
            message=f"Cannot transition from '{current_state}' to '{target_state}'",
            code="INVALID_STATE_TRANSITION",
        )


class FileValidationError(ValidationError):
    """Raised when an uploaded file fails validation checks."""

    def __init__(self, message: str = "File validation failed"):
        super().__init__(message=message)
