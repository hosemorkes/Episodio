"""Тесты новых полей, триггера finished_at и таблицы progress_log на настоящей PostgreSQL."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.models import MediaItem, ProgressLog
from scripts.init_db import apply_schema
from tests.test_api import create


def test_new_fields_roundtrip(client):
    created = create(client, description="Про дружбу", total_episodes=24, total_chapters=3, genres=["Драма"])
    assert created["description"] == "Про дружбу"
    assert created["total_episodes"] == 24
    assert created["total_chapters"] == 3
    assert created["genres"] == ["драма"]
    assert created["finished_at"] is None


def test_patch_total_and_description(client):
    item = create(client)
    response = client.patch(f"/items/{item['id']}", json={"total_episodes": 12, "description": "Текст"})
    assert response.status_code == 200
    assert response.json()["total_episodes"] == 12
    assert response.json()["description"] == "Текст"


def test_finished_at_set_on_completed(client):
    item = create(client)
    response = client.patch(f"/items/{item['id']}", json={"status": "completed"})
    assert response.json()["finished_at"] is not None


def test_finished_at_set_when_created_completed(client):
    assert create(client, status="completed")["finished_at"] is not None


def test_finished_at_kept_while_staying_completed(client):
    item = create(client)
    first = client.patch(f"/items/{item['id']}", json={"status": "completed"}).json()["finished_at"]
    second = client.patch(f"/items/{item['id']}", json={"rating": 9}).json()["finished_at"]
    assert second == first


def test_finished_at_reset_when_status_changes(client):
    item = create(client, status="completed")
    response = client.patch(f"/items/{item['id']}", json={"status": "watching"})
    assert response.json()["finished_at"] is None


def test_finished_at_ignored_in_request(client):
    item = create(client, finished_at="2020-01-01T00:00:00")
    assert item["finished_at"] is None


def test_progress_log_removed_with_item(client, db):
    item = create(client)
    db.add(ProgressLog(item_id=item["id"], unit="episode", number=1))
    db.commit()
    assert db.query(ProgressLog).count() == 1

    assert client.delete(f"/items/{item['id']}").status_code == 204
    db.expire_all()
    assert db.query(ProgressLog).count() == 0


def test_progress_log_rejects_bad_unit(client, db):
    item = create(client)
    db.add(ProgressLog(item_id=item["id"], unit="page", number=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_progress_log_rejects_unknown_item(db):
    db.add(ProgressLog(item_id=999, unit="movie", number=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_schema_is_idempotent(test_engine, db):
    db.add(MediaItem(title_ru="Дюна", category="book", status="completed"))
    db.commit()
    apply_schema(test_engine)
    apply_schema(test_engine)
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM media_items")).scalar_one() == 1
