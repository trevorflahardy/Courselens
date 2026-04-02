.PHONY: setup dev seed test lint check clean

# Full first-time setup
setup:
	@echo "=== Setting up Course Audit System ==="
	python3 -m venv .venv
	. .venv/bin/activate && pip install -e ".[dev]" 2>/dev/null || \
		. .venv/bin/activate && pip install fastapi "uvicorn[standard]" aiosqlite "pydantic>=2.10" \
		pydantic-settings networkx pypdf python-docx beautifulsoup4 fastmcp python-multipart \
		pytest pytest-asyncio ruff mypy httpx
	cd frontend && npm install
	. .venv/bin/activate && python scripts/setup_db.py
	@echo "=== Setup complete! Run 'make seed' to populate demo data ==="

# Start dev servers (backend + frontend)
dev:
	@echo "Starting backend on :8000 and frontend on :3000..."
	@trap 'kill 0' INT; \
	. .venv/bin/activate && uvicorn backend.main:app --reload --port 8000 & \
	cd frontend && npm run dev & \
	wait

# Seed demo data
seed:
	. .venv/bin/activate && python scripts/seed_demo.py

# Run all tests
test:
	. .venv/bin/activate && pytest tests/ -v
	cd frontend && npx vitest run 2>/dev/null || true

# Run linters
lint:
	. .venv/bin/activate && ruff check backend/ scripts/ mcp/ tests/
	cd frontend && npm run lint

# Type checking
check:
	. .venv/bin/activate && mypy backend/ --ignore-missing-imports
	cd frontend && npx tsc --noEmit

# Remove generated data
clean:
	rm -f data/audit.db
	rm -rf data/chroma/*
	rm -rf data/files/*
	rm -rf frontend/.next
	@echo "Cleaned generated data and build artifacts"
