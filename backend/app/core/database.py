"""CropStudio AI — Database Engine & Session Management.

Provides async SQLAlchemy engine, session factory, and a base model class
that all database models must inherit from.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import Settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""

    pass


def create_engine(settings: Settings) -> AsyncEngine:
    """Create and return the async SQLAlchemy engine."""
    db_url = settings.database_url or "sqlite+aiosqlite:///./cropstudio.db"

    if "sqlite" in db_url or not db_url:
        return create_async_engine("sqlite+aiosqlite:///./cropstudio.db", echo=settings.db_echo)

    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    connect_args = {}
    if "asyncpg" in db_url:
        connect_args["statement_cache_size"] = 0

    try:
        return create_async_engine(
            db_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            echo=settings.db_echo,
            pool_pre_ping=True,  # Detect stale connections before use
            connect_args=connect_args,
        )
    except Exception:
        return create_async_engine("sqlite+aiosqlite:///./cropstudio.db", echo=settings.db_echo)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Create a session factory bound to the given engine."""
    return async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


# Module-level defaults (initialized by app startup)
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_db(settings: Settings) -> None:
    """Initialize the database engine and session factory. Called once at app startup."""
    global _engine, _session_factory
    _engine = create_engine(settings)
    _session_factory = create_session_factory(_engine)


async def get_db_session() -> AsyncGenerator[AsyncSession]:
    """FastAPI dependency that yields a database session and handles cleanup."""
    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def check_db_health() -> bool:
    """Check if the database connection is healthy."""
    if _session_factory is None:
        return False
    try:
        async with _session_factory() as session:
            await session.execute(__import__("sqlalchemy").text("SELECT 1"))
            return True
    except Exception:
        return False


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get the database session factory. Useful for background tasks / event handlers."""
    if _session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _session_factory


async def close_db() -> None:
    """Close the database engine. Called on app shutdown."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
