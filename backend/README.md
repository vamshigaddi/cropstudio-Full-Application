# CropStudio AI — Backend Service

The backend API service for **CropStudio AI**, built with FastAPI, PostgreSQL (SQLAlchemy + Alembic), Pydantic v2, and integration with AI image generation providers (OpenAI, Gemini, Grok).

---

## 📋 Table of Contents

- [Prerequisites](#-prerequisites)
- [Project Structure](#-project-structure)
- [Environment Configuration](#-environment-configuration)
- [Local Installation & Setup](#-local-installation--setup)
- [Database Setup & Migrations](#-database-setup--migrations)
- [Running the Application](#-running-the-application)
- [Running Tests & Quality Checks](#-running-tests--quality-checks)
- [Docker Setup](#-docker-setup)
- [Useful Makefile Commands](#-useful-makefile-commands)

---

## ⚡ Prerequisites

Before running the project locally, ensure you have the following installed:

- **Python**: `>= 3.13` (or Python 3.11+)
- **PostgreSQL**: Local instance or remote database (e.g. Supabase PostgreSQL)
- **uv** *(Recommended)*: Fast Python package installer and resolver (`pip install uv` or install via system installer)
- **Make**: *(Optional)* Useful for running Makefile shortcuts (available on Linux/macOS or via WSL/Git Bash/Chocolatey on Windows)

---

## 📁 Project Structure

```text
backend/
├── alembic/              # Database migration scripts
├── alembic.ini           # Alembic configuration
├── app/                  # Main FastAPI application source code
│   ├── core/             # Config, Database, Middleware, Logging, Events
│   ├── integrations/     # AI providers (OpenAI, Gemini, Grok), Storage, Billing
│   └── modules/          # Business domains (auth, generation, prompts, billing, etc.)
├── storage/              # Local storage folder for uploaded assets (in local mode)
├── tests/                # Test suite (pytest)
├── Dockerfile            # Container image definition
├── Makefile              # Development task automation commands
├── pyproject.toml        # Project metadata and dependencies
└── seed_prompts.py       # Seed script for initial prompt templates
```

---

## ⚙️ Environment Configuration

1. Create a `.env` file in the `backend/` directory (you can copy values from `.env` or set up your own variables):

```bash
# App
DEBUG=true
ENVIRONMENT=development
LOG_JSON=false
LOG_LEVEL=DEBUG

# Database
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:<port>/<dbname>

# Auth (Supabase)
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# Storage Provider (local | gcs)
STORAGE_PROVIDER=local
LOCAL_STORAGE_PATH=./storage

# Queue Provider (local | cloud_tasks)
QUEUE_PROVIDER=local
WORKER_URL=http://localhost:8001

# AI Provider API Keys
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
GROK_API_KEY=your_grok_api_key

# Billing (Razorpay)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Admin Creation Secret
ADMIN_CREATION_SECRET=your_admin_secret
```

---

## 🛠️ Local Installation & Setup

### 1. Clone & Navigate to Backend
```bash
cd backend
```

### 2. Set Up Virtual Environment

#### Option A: Using `uv` (Recommended)
```bash
# Create virtual environment
uv venv

# Activate virtual environment
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# Windows (CMD):
.venv\Scripts\activate.bat
# macOS/Linux:
source .venv/bin/activate
```

#### Option B: Standard Python `venv`
```bash
python -m venv .venv

# Activate environment (Windows PowerShell)
.venv\Scripts\Activate.ps1
# Activate environment (macOS/Linux)
source .venv/bin/activate
```

### 3. Install Dependencies

Using `uv` (Fast):
```bash
uv pip install -e ".[dev]"
```
*Or using `make`:*
```bash
make install
```

Using standard `pip`:
```bash
pip install -e ".[dev]"
```

---

## 🗄️ Database Setup & Migrations

Ensure your PostgreSQL database is running and accessible via the `DATABASE_URL` specified in your `.env` file.

### 1. Apply Database Migrations
Run Alembic migrations to create tables and update schema:

```bash
alembic upgrade head
```
*Or using Makefile:*
```bash
make migrate
```

### 2. Seed Prompt Templates
Seed default prompt templates (`lifestyle`, `try_on`, `ghost_mannequin`, `folded`, `flat_lay`, `closeup`) into the database:

```bash
python seed_prompts.py
```

---

## 🚀 Running the Application

Start the local Uvicorn development server with hot reload:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
*Or using Makefile:*
```bash
make dev
```

The service will be live at:
- **API Server**: `http://localhost:8000`
- **Interactive Swagger Docs**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`
- **Health Check**: `http://localhost:8000/api/v1/health`

---

## 🧪 Running Tests & Quality Checks

### Run Tests
```bash
make test
# or
pytest tests/ -v
```

### Run Tests with Coverage
```bash
make test-cov
```

### Linting & Code Formatting
```bash
# Check code style & lint issues
make lint

# Automatically format code with ruff
make format

# Run mypy static type checking
make typecheck

# Run all checks combined
make check
```

---

## 🐳 Docker Setup

You can also run the application using Docker:

### 1. Build the Docker Image
```bash
docker build -t cropstudio-backend .
```

### 2. Run the Container
```bash
docker run -p 8000:8000 --env-file .env cropstudio-backend
```

---

## 🛠️ Useful Makefile Commands

| Command | Description |
|---|---|
| `make dev` | Start development server with hot reload (`0.0.0.0:8000`) |
| `make install` | Install backend dependencies in editable mode |
| `make migrate` | Apply all database migrations to latest revision |
| `make migrate-create msg="description"` | Create a new Alembic migration revision |
| `make migrate-rollback` | Rollback the last applied migration |
| `make test` | Run test suite |
| `make test-cov` | Run tests with coverage output |
| `make lint` | Run Ruff linting and formatting check |
| `make format` | Automatically format code with Ruff |
| `make typecheck` | Run Mypy type checks |
| `make check` | Run all linters, type checks, and tests |
