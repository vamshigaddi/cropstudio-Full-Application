.PHONY: dev test lint format check migrate

# Start development server with hot reload
dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Run tests (split to prevent pytest-asyncio event loop conflicts)
test:
	pytest backend/tests/test_admin_endpoints.py backend/tests/test_admin_management.py backend/tests/test_audit.py backend/tests/test_auth.py -v --tb=short
	pytest backend/tests/test_batches.py backend/tests/test_billing.py backend/tests/test_events.py backend/tests/test_gemini.py backend/tests/test_generation.py backend/tests/test_grok.py backend/tests/test_health.py backend/tests/test_jobs.py backend/tests/test_openai.py backend/tests/test_prompts.py backend/tests/test_storage.py backend/tests/test_uploads.py -v --tb=short

# Run tests with coverage
test-cov:
	pytest --cov=app --cov-report=term-missing backend/tests/test_admin_endpoints.py backend/tests/test_admin_management.py backend/tests/test_audit.py backend/tests/test_auth.py -v
	pytest --cov=app --cov-append --cov-report=term-missing backend/tests/test_batches.py backend/tests/test_billing.py backend/tests/test_events.py backend/tests/test_gemini.py backend/tests/test_generation.py backend/tests/test_grok.py backend/tests/test_health.py backend/tests/test_jobs.py backend/tests/test_openai.py backend/tests/test_prompts.py backend/tests/test_storage.py backend/tests/test_uploads.py -v

# Lint code
lint:
	ruff check app/ tests/
	ruff format --check app/ tests/

# Format code
format:
	ruff format app/ tests/
	ruff check --fix app/ tests/

# Type check
typecheck:
	mypy app/

# Run all checks (lint + typecheck + tests)
check: lint typecheck test

# Create a new migration
migrate-create:
	alembic revision --autogenerate -m "$(msg)"

# Apply all migrations
migrate:
	alembic upgrade head

# Rollback one migration
migrate-rollback:
	alembic downgrade -1

# Install dependencies
install:
	uv pip install -e ".[dev]"
