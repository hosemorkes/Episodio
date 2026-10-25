"""Тесты прогресса, журнала, жанров, сортировки и ключа API (PostgreSQL, см. tests/conftest.py)."""
from backend.models import ProgressLog
from tests.test_api import create, titles


def mark(client, item_id, delta=1):
    return client.post(f"/items/{item_id}/progress", json={"delta": delta})


# --- POST /items/{id}/progress ---

def test_mark_episode_increments_and_logs(client):
    item = create(client, status="planned", current_episode=None, total_episodes=12)
    response = mark(client, item["id"])
    assert response.status_code == 200
    body = response.json()
    assert body["item"]["current_episode"] == 1
    assert body["item"]["status"] == "watching"
    assert body["entry"]["unit"] == "episode"
    assert body["entry"]["number"] == 1
    assert body["entry"]["title_ru"] == item["title_ru"]


def test_mark_chapter_for_manga(client):
    item = create(client, category="manga", current_season=None, current_episode=None, current_chapter=4)
    body = mark(client, item["id"]).json()
    assert body["item"]["current_chapter"] == 5
    assert body["item"]["current_episode"] is None
    assert body["entry"]["unit"] == "chapter"


def test_last_episode_completes_item(client):
    item = create(client, current_episode=11, total_episodes=12, status="watching")
    body = mark(client, item["id"]).json()
    assert body["item"]["status"] == "completed"
    assert body["item"]["finished_at"] is not None


def test_mark_beyond_total_returns_409(client):
    item = create(client, current_episode=12, total_episodes=12, status="completed")
    assert mark(client, item["id"]).status_code == 409


def test_mark_without_total_keeps_counting(client):
    item = create(client, current_episode=3)
    assert mark(client, item["id"]).json()["item"]["current_episode"] == 4


def test_mark_completed_without_progress_returns_to_watching(client):
    item = create(client, status="completed", current_episode=None)
    assert mark(client, item["id"]).json()["item"]["status"] == "watching"


def test_mark_movie_returns_400(client):
    item = create(client, category="movie", current_season=None, current_episode=None)
    assert mark(client, item["id"]).status_code == 400


def test_mark_missing_item_returns_404(client):
    assert mark(client, 999).status_code == 404


def test_invalid_delta_returns_422(client):
    item = create(client)
    assert client.post(f"/items/{item['id']}/progress", json={"delta": 2}).status_code == 422


def test_rollback_decrements_and_removes_last_log(client, db):
    item = create(client, current_episode=2)
    mark(client, item["id"])
    mark(client, item["id"])
    assert db.query(ProgressLog).count() == 2

    body = mark(client, item["id"], -1).json()
    assert body["item"]["current_episode"] == 3
    assert body["entry"]["number"] == 4
    db.expire_all()
    assert [e.number for e in db.query(ProgressLog).order_by(ProgressLog.id)] == [3]


def test_rollback_with_empty_log_only_decrements(client):
    item = create(client, current_episode=5)
    body = mark(client, item["id"], -1).json()
    assert body["item"]["current_episode"] == 4
    assert body["entry"] is None


def test_rollback_does_not_go_below_zero(client):
    item = create(client, current_episode=0)
    assert mark(client, item["id"], -1).json()["item"]["current_episode"] == 0


def test_rollback_keeps_null_progress(client):
    item = create(client, current_episode=None)
    assert mark(client, item["id"], -1).json()["item"]["current_episode"] is None


def test_rollback_from_completed_returns_to_watching(client):
    item = create(client, current_episode=12, total_episodes=12, status="completed")
    body = mark(client, item["id"], -1).json()
    assert body["item"]["status"] == "watching"
    assert body["item"]["current_episode"] == 11
    assert body["item"]["finished_at"] is None


# --- журнал фильма ---

def test_movie_completed_writes_log_and_revert_removes_it(client, db):
    movie = create(client, category="movie", current_season=None, current_episode=None)
    assert db.query(ProgressLog).count() == 0

    client.patch(f"/items/{movie['id']}", json={"status": "completed"})
    db.expire_all()
    entry = db.query(ProgressLog).one()
    assert (entry.unit, entry.number) == ("movie", 1)

    # повторный PATCH без смены статуса не дублирует запись
    client.patch(f"/items/{movie['id']}", json={"rating": 8})
    db.expire_all()
    assert db.query(ProgressLog).count() == 1

    client.patch(f"/items/{movie['id']}", json={"status": "planned"})
    db.expire_all()
    assert db.query(ProgressLog).count() == 0


def test_movie_created_completed_writes_log(client, db):
    create(client, category="movie", status="completed", current_season=None, current_episode=None)
    assert db.query(ProgressLog).count() == 1


def test_non_movie_status_change_does_not_touch_log(client, db):
    item = create(client)
    client.patch(f"/items/{item['id']}", json={"status": "completed"})
    db.expire_all()
    assert db.query(ProgressLog).count() == 0


# --- GET /log ---

def test_log_returns_latest_first_with_titles(client):
    a = create(client, title_ru="Первый", title_original=None, current_episode=0)
    b = create(client, title_ru="Второй", title_original=None, category="manga", current_episode=None, current_chapter=0)
    mark(client, a["id"])
    mark(client, b["id"])
    mark(client, a["id"])

    entries = client.get("/log").json()
    assert [(e["title_ru"], e["number"]) for e in entries] == [("Первый", 2), ("Второй", 1), ("Первый", 1)]
    assert entries[1]["unit"] == "chapter"
    assert entries[1]["category"] == "manga"


def test_log_pagination_with_before(client):
    item = create(client, current_episode=0)
    for _ in range(5):
        mark(client, item["id"])

    first = client.get("/log", params={"limit": 2}).json()
    assert [e["number"] for e in first] == [5, 4]
    second = client.get("/log", params={"limit": 2, "before": first[-1]["id"]}).json()
    assert [e["number"] for e in second] == [3, 2]


def test_log_filter_by_item(client):
    a = create(client, title_ru="А", title_original=None)
    b = create(client, title_ru="Б", title_original=None)
    mark(client, a["id"])
    mark(client, b["id"])
    assert [e["title_ru"] for e in client.get("/log", params={"item_id": b["id"]}).json()] == ["Б"]


def test_log_limit_validated(client):
    assert client.get("/log", params={"limit": 0}).status_code == 422
    assert client.get("/log", params={"limit": 101}).status_code == 422


# --- GET /genres ---

def test_genres_distinct_sorted(client):
    create(client, title_ru="А", title_original=None, genres=["Драма", "Комедия"])
    create(client, title_ru="Б", title_original=None, genres=["драма", "экшен"], category="anime")
    assert client.get("/genres").json() == ["драма", "комедия", "экшен"]
    assert client.get("/genres", params={"category": "anime"}).json() == ["драма", "экшен"]


def test_genres_empty(client):
    assert client.get("/genres").json() == []


# --- сортировка и пагинация списка ---

def test_sort_by_title_and_order(client):
    for title in ("Б", "А", "В"):
        create(client, title_ru=title, title_original=None)
    assert titles(client.get("/items/", params={"sort": "title_ru", "order": "asc"})) == ["А", "Б", "В"]
    assert titles(client.get("/items/", params={"sort": "title_ru", "order": "desc"})) == ["В", "Б", "А"]


def test_sort_by_rating_puts_empty_last(client):
    create(client, title_ru="без оценки", title_original=None)
    create(client, title_ru="семь", title_original=None, rating=7)
    create(client, title_ru="девять", title_original=None, rating=9)
    assert titles(client.get("/items/", params={"sort": "rating", "order": "desc"})) == ["девять", "семь", "без оценки"]
    assert titles(client.get("/items/", params={"sort": "rating", "order": "asc"})) == ["семь", "девять", "без оценки"]


def test_limit_and_offset(client):
    for title in ("А", "Б", "В", "Г"):
        create(client, title_ru=title, title_original=None)
    params = {"sort": "title_ru", "order": "asc"}
    assert titles(client.get("/items/", params={**params, "limit": 2})) == ["А", "Б"]
    assert titles(client.get("/items/", params={**params, "limit": 2, "offset": 2})) == ["В", "Г"]
    assert titles(client.get("/items/", params={**params, "offset": 3})) == ["Г"]


def test_invalid_sort_and_limit_return_422(client):
    assert client.get("/items/", params={"sort": "raw"}).status_code == 422
    assert client.get("/items/", params={"limit": 501}).status_code == 422
    assert client.get("/items/", params={"offset": -1}).status_code == 422


# --- X-API-Key ---

def test_without_api_key_env_everything_is_open(client):
    assert client.get("/items/").status_code == 200


def test_api_key_required_when_set(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/items/").status_code == 401
    assert client.get("/items/", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/items/", headers={"X-API-Key": "secret"}).status_code == 200


def test_api_key_protects_writes_and_new_endpoints(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.post("/items/", json={"title_ru": "Дюна", "category": "book"}).status_code == 401
    assert client.get("/genres").status_code == 401
    assert client.get("/log").status_code == 401
    assert client.post("/items/1/progress", json={"delta": 1}).status_code == 401
    assert client.post("/items/", json={"title_ru": "Дюна", "category": "book"}, headers={"X-API-Key": "secret"}).status_code == 201


def test_health_and_root_open_without_key(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/health").status_code == 200
    assert client.get("/").status_code == 200


def test_posters_static_open_without_key(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    # файла нет, но 404 (а не 401) означает, что ключ для статики не требуется
    assert client.get("/posters/none.jpg").status_code == 404


def test_empty_api_key_env_means_disabled(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "")
    assert client.get("/items/").status_code == 200
