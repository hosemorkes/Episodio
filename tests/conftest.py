"""Общие фикстуры. Тесты API работают с настоящей PostgreSQL из TEST_DATABASE_URL.

Если переменная не задана или база недоступна, тесты, которым нужна БД, пропускаются.
"""
import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from backend.database import get_database_url, get_db, normalize_url
from backend.main import app
from scripts.init_db import apply_schema

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@pytest.fixture(autouse=True)
def no_api_key(monkeypatch):
    """Защита X-API-Key выключена, даже если API_KEY задан в .env; тесты ключа включают её сами."""
    monkeypatch.delenv("API_KEY", raising=False)


@pytest.fixture(autouse=True)
def clean_popular_cache():
    """Кэш популярного (час) общий для процесса: между тестами его нужно сбрасывать."""
    from backend import catalog

    catalog.clear_popular_cache()
    yield
    catalog.clear_popular_cache()


@pytest.fixture(scope="session")
def test_engine():
    """Движок тестовой базы; в начале сессии применяет к ней scripts/schema.sql."""
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Тесты с БД пропущены: не задан TEST_DATABASE_URL (см. .env.example)")
    url = normalize_url(raw_url)

    # TRUNCATE перед каждым тестом стёр бы данные, поэтому основную базу подменять нельзя
    if url == get_database_url():
        pytest.exit(
            "TEST_DATABASE_URL совпадает с основной базой — тесты остановлены, чтобы не стереть данные",
            returncode=2,
        )

    engine = create_engine(url, connect_args={"connect_timeout": 3})
    try:
        apply_schema(engine)
    except OperationalError as e:
        engine.dispose()
        target = url.render_as_string(hide_password=True)
        reason = str(e.orig).strip().splitlines()[0] if e.orig else "нет соединения"
        pytest.skip(f"Тесты с БД пропущены: тестовая база недоступна ({target}): {reason}")
    yield engine
    engine.dispose()


@pytest.fixture
def db(test_engine):
    """Сессия к тестовой базе; перед каждым тестом таблица очищается."""
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE media_items, progress_log, showcases RESTART IDENTITY"))
    session = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """TestClient, у которого зависимость get_db подменена тестовой сессией."""

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
