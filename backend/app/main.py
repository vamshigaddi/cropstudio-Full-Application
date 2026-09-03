"""CropStudio AI — FastAPI Application Entrypoint.

Creates and configures the FastAPI application with all middleware,
exception handlers, routers, and lifecycle events.
"""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import close_db, init_db
from app.core.error_handlers import register_exception_handlers
from app.core.health import router as health_router
from app.core.logging import get_logger, setup_logging
from app.core.middleware import RequestIDMiddleware
from app.modules.batches.routes import router as batches_router
from app.modules.billing.routes import router as billing_router
from app.modules.jobs.worker_routes import router as worker_router
from app.modules.prompts.routes import router as prompts_router
from app.modules.uploads.routes import router as uploads_router
from app.modules.users.routes import router as users_router
from app.modules.audit.routes import router as audit_router
from app.modules.waitlist.routes import router as waitlist_router

settings = get_settings()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan: startup and shutdown events."""
    # Startup
    setup_logging(settings)
    logger.info(
        "starting_application",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )
    init_db(settings)
    logger.info("database_initialized")

    # ─── Auto-create Database Tables in Background ───
    async def _async_create_tables():
        try:
            from app.core.database import _engine, Base
            import app.modules.users.models  # noqa
            import app.modules.batches.models  # noqa
            import app.modules.jobs.models  # noqa
            import app.modules.prompts.models  # noqa
            import app.modules.uploads.models  # noqa
            import app.modules.audit.models  # noqa
            import app.modules.waitlist.models  # noqa
            import app.modules.generation.models  # noqa
            import app.modules.billing.models  # noqa

            if _engine:
                async with _engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                logger.info("database_tables_created")
        except Exception as e:
            logger.warning("database_table_creation_warning", error=str(e))

    import asyncio
    asyncio.create_task(_async_create_tables())

    # ─── Event Bus Setup ───
    from app.core.event_subscribers import (
        audit_event_handler,
        log_event_handler,
        on_batch_completed,
        on_job_completed,
        on_job_failed,
        on_quota_exceeded,
    )
    from app.core.events import get_event_bus

    bus = get_event_bus()
    # Universal logging for all events
    bus.subscribe("job.completed", log_event_handler)
    bus.subscribe("job.failed", log_event_handler)
    bus.subscribe("batch.completed", log_event_handler)
    bus.subscribe("quota.exceeded", log_event_handler)
    # Specific handlers
    bus.subscribe("job.completed", on_job_completed)
    bus.subscribe("job.completed", audit_event_handler)
    bus.subscribe("job.failed", on_job_failed)
    bus.subscribe("job.failed", audit_event_handler)
    bus.subscribe("batch.completed", on_batch_completed)
    bus.subscribe("batch.completed", audit_event_handler)
    bus.subscribe("quota.exceeded", on_quota_exceeded)
    bus.subscribe("quota.exceeded", audit_event_handler)
    logger.info("event_bus_initialized")

    yield

    # Shutdown
    await close_db()
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    """Application factory. Creates and configures the FastAPI app."""
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="AI-powered ecommerce product photography platform",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # ─── Middleware (order matters: last added = first executed) ───
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIDMiddleware)

    # ─── Exception Handlers ───
    register_exception_handlers(app)

    @app.api_route("/", methods=["GET", "HEAD"])
    async def root() -> dict[str, str]:
        return {
            "status": "ok",
            "name": settings.app_name,
            "version": settings.app_version,
            "environment": settings.environment,
        }

    # ─── Routers ───
    app.include_router(health_router)
    app.include_router(users_router, prefix=settings.api_prefix)
    app.include_router(uploads_router, prefix=settings.api_prefix)
    app.include_router(batches_router, prefix=settings.api_prefix)
    app.include_router(prompts_router, prefix=settings.api_prefix)
    app.include_router(billing_router, prefix=settings.api_prefix)
    app.include_router(worker_router, prefix=settings.api_prefix)
    app.include_router(audit_router, prefix=settings.api_prefix)
    app.include_router(waitlist_router, prefix=settings.api_prefix)

    # ─── Local Storage Server ───
    if settings.storage_provider == "local":
        os.makedirs(settings.local_storage_path, exist_ok=True)
        app.mount("/local-storage", StaticFiles(directory=settings.local_storage_path), name="local-storage")

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
