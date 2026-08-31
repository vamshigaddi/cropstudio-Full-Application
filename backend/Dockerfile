# ─── CropStudio AI Backend (Cloud Run & Docker Optimized) ───

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy dependency specifications
COPY pyproject.toml ./

# Install python dependencies
RUN uv pip install --system --no-cache -e "."

# Copy full application code
COPY . .

# Pre-download u2net model weights during build to eliminate runtime cold starts
RUN python -c "from rembg import new_session; new_session('u2net')" || true

# Expose container port (Cloud Run defaults to 8080)
EXPOSE 8080

# Start Uvicorn bound to dynamic $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
