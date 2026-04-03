"""Pytest shared fixtures for isolated test database setup."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database(tmp_path_factory: pytest.TempPathFactory) -> None:
    """Run tests against a temporary seeded SQLite DB, never the real data DB."""
    import backend.db as db_module
    import scripts.seed_demo as seed_demo
    import scripts.setup_db as setup_db

    temp_db_dir = tmp_path_factory.mktemp("sqlite")
    temp_db_path = Path(temp_db_dir) / "audit.db"

    original_db_path = db_module.DB_PATH
    original_setup_path = setup_db.DB_PATH
    original_seed_path = seed_demo.DB_PATH

    db_module.DB_PATH = temp_db_path
    setup_db.DB_PATH = temp_db_path
    seed_demo.DB_PATH = temp_db_path

    try:
        asyncio.run(db_module.close_db())
    except RuntimeError:
        pass

    setup_db.setup_database()
    seed_demo.seed()

    yield

    try:
        asyncio.run(db_module.close_db())
    except RuntimeError:
        pass

    db_module.DB_PATH = original_db_path
    setup_db.DB_PATH = original_setup_path
    seed_demo.DB_PATH = original_seed_path
