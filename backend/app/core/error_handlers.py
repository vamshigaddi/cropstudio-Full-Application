"""CropStudio AI — Global Exception Handlers.

Maps domain exceptions to HTTP responses. Registered with the FastAPI app
so business logic never needs to know about HTTP status codes.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.exceptions import (
    AuthenticationError,
    AuthorizationError,
    CropStudioError,
    FileValidationError,
    NotFoundError,
    QuotaExceededError,
    ValidationError,
)
from app.core.logging import get_logger

logger = get_logger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    """Register all domain exception handlers on the FastAPI app."""

    @app.exception_handler(NotFoundError)
    async def not_found_handler(_request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(ValidationError)
    async def validation_handler(_request: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(FileValidationError)
    async def file_validation_handler(_request: Request, exc: FileValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(AuthenticationError)
    async def auth_handler(_request: Request, exc: AuthenticationError) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(AuthorizationError)
    async def authz_handler(_request: Request, exc: AuthorizationError) -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(QuotaExceededError)
    async def quota_handler(_request: Request, exc: QuotaExceededError) -> JSONResponse:
        return JSONResponse(
            status_code=402,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(CropStudioError)
    async def cropstudio_handler(_request: Request, exc: CropStudioError) -> JSONResponse:
        logger.error("unhandled_domain_error", error_code=exc.code, message=exc.message)
        return JSONResponse(
            status_code=500,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(Exception)
    async def generic_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": "An unexpected error occurred"},
        )
