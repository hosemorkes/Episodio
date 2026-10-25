"""Тесты GET /stats (PostgreSQL, см. tests/conftest.py)."""
from datetime import date, datetime, timedelta

from backend import stats
from backend.models import ProgressLog
from tests.test_api import create


def get_stats(client, **params):
    response = client.get("/stats", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def log_at(db, item_id, when, unit="episode", number=1):
    db.add(ProgressLog(item_id=item_id, unit=unit, number=number, logged_at=when))
    db.commit()


def by_name(rows):
    return {r["name"]: r for r in rows}


# --- пустая база ---

def test_empty_library(client):
    body = get_stats(client)
    assert body["total_items"] == 0
    for key in ("genres", "countries", "categories", "statuses", "years", "top_items"):
        assert body[key] == []
    assert body["totals"] == {"episodes": 0, "chapters": 0, "movies": 0}
    assert body["marks"] == {"episodes": 0, "chapters": 0, "movies": 0}


def test_default_period_is_last_seven_days_zero_filled(client):
    body = get_stats(client)
    days = [d["date"] for d in body["activity"]]
    today = date.today()
    assert days == [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    assert all(d["count"] == 0 for d in body["activity"])
    assert body["period_from"] == days[0] and body["period_to"] == days[-1]


# --- распределения ---

def test_genres_are_unnested_and_counted_per_title(client):
    create(client, title_ru="А", title_original=None, genres=["драма", "комедия"], current_episode=10)
    create(client, title_ru="Б", title_original=None, genres=["драма"], current_episode=5)
    create(client, title_ru="В", title_original=None, genres=[], current_episode=99)
    genres = by_name(get_stats(client)["genres"])
    assert genres["драма"] == {"name": "драма", "items": 2, "progress": 15}
    assert genres["комедия"] == {"name": "комедия", "items": 1, "progress": 10}
    assert set(genres) == {"драма", "комедия"}


def test_genres_sorted_by_items_then_progress_then_name(client):
    create(client, title_ru="А", title_original=None, genres=["б"], current_episode=5)
    create(client, title_ru="Б", title_original=None, genres=["а"], current_episode=5)
    create(client, title_ru="В", title_original=None, genres=["в"], current_episode=9)
    create(client, title_ru="Г", title_original=None, genres=["г"], current_episode=1)
    create(client, title_ru="Д", title_original=None, genres=["г"], current_episode=1)
    # два тайтла ("г") обгоняют один, даже если у них меньше серий; при равенстве — больше прогресса, затем имя
    assert [g["name"] for g in get_stats(client)["genres"]] == ["г", "в", "а", "б"]


def test_titles_without_progress_still_count_in_distributions(client):
    create(client, title_ru="Фильм", title_original=None, category="movie", genres=["драма"], country="США", release_year=2010, status="planned", current_season=None, current_episode=None)
    create(client, title_ru="Книга", title_original=None, category="book", genres=["драма"], country="США", release_year=2010, current_season=None, current_episode=None)
    body = get_stats(client)
    assert body["genres"] == [{"name": "драма", "items": 2, "progress": 0}]
    assert body["countries"] == [{"name": "США", "items": 2, "progress": 0}]
    assert body["years"] == [{"year": 2010, "items": 2, "progress": 0}]
    assert body["top_items"] == []


def test_limit_applies_to_genres_countries_and_top(client):
    for i in range(4):
        create(client, title_ru=f"Т{i}", title_original=None, genres=[f"ж{i}"], country=f"С{i}", current_episode=i + 1)
    body = get_stats(client, limit=2)
    assert len(body["genres"]) == len(body["countries"]) == len(body["top_items"]) == 2
    assert len(get_stats(client)["genres"]) == 4


def test_countries_skip_empty_and_null(client):
    create(client, title_ru="А", title_original=None, country="США", current_episode=3)
    create(client, title_ru="Б", title_original=None, country=None, current_episode=3)
    create(client, title_ru="В", title_original=None, country="", current_episode=3)
    assert get_stats(client)["countries"] == [{"name": "США", "items": 1, "progress": 3}]


def test_years_ascending_without_empty(client):
    create(client, title_ru="А", title_original=None, release_year=2020, current_episode=4)
    create(client, title_ru="Б", title_original=None, release_year=2005, current_episode=2)
    create(client, title_ru="В", title_original=None, release_year=2020, current_episode=1)
    create(client, title_ru="Г", title_original=None, release_year=None)
    assert get_stats(client)["years"] == [
        {"year": 2005, "items": 1, "progress": 2},
        {"year": 2020, "items": 2, "progress": 5},
    ]


def test_statuses_and_categories(client):
    create(client, title_ru="А", title_original=None, status="watching")
    create(client, title_ru="Б", title_original=None, status="watching", category="anime")
    create(client, title_ru="В", title_original=None, status="planned", category="anime")
    body = get_stats(client)
    assert body["total_items"] == 3
    assert {r["name"]: r["items"] for r in body["statuses"]} == {"watching": 2, "planned": 1}
    assert {r["name"]: r["items"] for r in body["categories"]} == {"tv_series": 1, "anime": 2}


# --- прогресс: серии, главы и фильмы раздельно ---

def test_totals_separate_episodes_chapters_and_movies(client):
    create(client, title_ru="Сериал", title_original=None, current_episode=12)
    create(client, title_ru="Аниме", title_original=None, category="anime", current_episode=8)
    create(client, title_ru="Манга", title_original=None, category="manga", current_season=None, current_episode=None, current_chapter=40)
    create(client, title_ru="Фильм", title_original=None, category="movie", status="completed", current_season=None, current_episode=None)
    create(client, title_ru="Фильм в планах", title_original=None, category="movie", status="planned", current_season=None, current_episode=None)
    assert get_stats(client)["totals"] == {"episodes": 20, "chapters": 40, "movies": 1}


def test_chapters_not_counted_as_episodes_even_if_episode_field_set(client):
    create(client, title_ru="Книга", title_original=None, category="book", current_season=None, current_episode=7, current_chapter=3)
    assert get_stats(client)["totals"] == {"episodes": 0, "chapters": 3, "movies": 0}


def test_top_items_by_progress(client):
    create(client, title_ru="Короткий", title_original=None, current_episode=3)
    create(client, title_ru="Длинный", title_original="Long", category="anime", current_episode=500)
    create(client, title_ru="Без прогресса", title_original=None, current_episode=None)
    create(client, title_ru="Фильм", title_original=None, category="movie", status="completed", current_season=None, current_episode=None)
    create(client, title_ru="Фильм в планах", title_original=None, category="movie", status="planned", current_season=None, current_episode=None)
    top = get_stats(client)["top_items"]
    assert [(t["title_ru"], t["progress"], t["category"]) for t in top] == [
        ("Длинный", 500, "anime"),
        ("Короткий", 3, "tv_series"),
        ("Фильм", 1, "movie"),
    ]
    assert top[0]["title_original"] == "Long"


# --- журнал: активность по дням ---

def test_activity_counts_marks_per_day_inclusive_bounds(client, db):
    item = create(client, title_ru="А", title_original=None, current_episode=0)
    manga = create(client, title_ru="М", title_original=None, category="manga", current_season=None, current_episode=None, current_chapter=0)
    day = date(2026, 3, 10)
    log_at(db, item["id"], datetime(2026, 3, 10, 0, 0, 0))
    log_at(db, item["id"], datetime(2026, 3, 10, 23, 59, 59))
    log_at(db, manga["id"], datetime(2026, 3, 11, 12, 0), unit="chapter")
    log_at(db, item["id"], datetime(2026, 3, 12, 0, 0, 0))  # следующий день после конца периода
    log_at(db, item["id"], datetime(2026, 3, 9, 23, 59, 59))  # день до начала

    body = get_stats(client, **{"from": day.isoformat(), "to": "2026-03-11"})
    assert body["activity"] == [{"date": "2026-03-10", "count": 2}, {"date": "2026-03-11", "count": 1}]
    assert body["marks"] == {"episodes": 2, "chapters": 1, "movies": 0}


def test_activity_gaps_are_zero(client, db):
    item = create(client, title_ru="А", title_original=None, current_episode=0)
    log_at(db, item["id"], datetime(2026, 3, 12, 20, 0))
    body = get_stats(client, **{"from": "2026-03-10", "to": "2026-03-14"})
    assert [d["count"] for d in body["activity"]] == [0, 0, 1, 0, 0]


def test_single_day_period(client):
    body = get_stats(client, **{"from": "2026-03-10", "to": "2026-03-10"})
    assert body["activity"] == [{"date": "2026-03-10", "count": 0}]


def test_movie_completion_is_counted_in_marks(client):
    create(client, title_ru="Фильм", title_original=None, category="movie", status="completed", current_season=None, current_episode=None)
    today = date.today().isoformat()
    body = get_stats(client, **{"from": today, "to": today})
    assert body["marks"]["movies"] == 1
    assert body["activity"] == [{"date": today, "count": 1}]


def test_rollback_removes_mark_from_activity(client):
    item = create(client, title_ru="А", title_original=None, current_episode=0)
    client.post(f"/items/{item['id']}/progress", json={"delta": 1})
    client.post(f"/items/{item['id']}/progress", json={"delta": 1})
    client.post(f"/items/{item['id']}/progress", json={"delta": -1})
    assert get_stats(client)["activity"][-1]["count"] == 1


def test_library_distributions_ignore_period(client):
    create(client, title_ru="А", title_original=None, genres=["драма"], current_episode=4)
    body = get_stats(client, **{"from": "2000-01-01", "to": "2000-01-07"})
    assert body["genres"] == [{"name": "драма", "items": 1, "progress": 4}]
    assert body["totals"]["episodes"] == 4
    assert all(d["count"] == 0 for d in body["activity"])


# --- проверка параметров ---

def test_period_start_after_end_returns_422(client):
    response = client.get("/stats", params={"from": "2026-03-10", "to": "2026-03-09"})
    assert response.status_code == 422
    assert "позже" in response.json()["detail"]


def test_period_too_long_returns_422(client):
    assert client.get("/stats", params={"from": "2024-01-01", "to": "2026-01-01"}).status_code == 422
    assert client.get("/stats", params={"from": "2025-01-01", "to": "2025-12-31"}).status_code == 200


def test_invalid_params_return_422(client):
    assert client.get("/stats", params={"from": "вчера"}).status_code == 422
    assert client.get("/stats", params={"limit": 0}).status_code == 422
    assert client.get("/stats", params={"limit": 51}).status_code == 422


def test_only_from_uses_today_as_end(client):
    start = (date.today() - timedelta(days=2)).isoformat()
    body = get_stats(client, **{"from": start})
    assert body["period_to"] == date.today().isoformat()
    assert len(body["activity"]) == 3


def test_requires_api_key_when_set(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/stats").status_code == 401
    assert client.get("/stats", headers={"X-API-Key": "secret"}).status_code == 200


# --- resolve_period без базы ---

def test_resolve_period_defaults():
    today = date(2026, 3, 10)
    assert stats.resolve_period(None, None, today) == (date(2026, 3, 4), today)
    assert stats.resolve_period(date(2026, 3, 1), None, today) == (date(2026, 3, 1), today)
