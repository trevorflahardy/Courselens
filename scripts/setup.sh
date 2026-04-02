#!/usr/bin/env bash
set -euo pipefail

echo "=== Course Audit System — First-Time Setup ==="

# Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node is required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required"; exit 1; }

echo "Python: $(python3 --version)"
echo "Node:   $(node --version)"
echo "npm:    $(npm --version)"

# Python environment
echo ""
echo "--- Setting up Python environment ---"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo "Created .venv"
else
    echo ".venv already exists"
fi

source .venv/bin/activate

pip install -q fastapi "uvicorn[standard]" aiosqlite "pydantic>=2.10" \
    pydantic-settings networkx pypdf python-docx beautifulsoup4 \
    fastmcp python-multipart \
    pytest pytest-asyncio ruff mypy httpx

echo "Python dependencies installed"

# Frontend
echo ""
echo "--- Setting up frontend ---"
cd frontend
npm install
cd ..
echo "Frontend dependencies installed"

# Database
echo ""
echo "--- Setting up database ---"
python scripts/setup_db.py

# Environment file
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "Created .env from .env.example — fill in your values"
else
    echo ".env already exists"
fi

# Data directories
mkdir -p data/chroma data/files

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Canvas course ID"
echo "  2. Run 'make seed' to populate demo data"
echo "  3. Run 'make dev' to start development servers"
