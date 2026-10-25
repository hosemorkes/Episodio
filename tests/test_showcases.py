"""Тесты витрин: управление, выборка топа, публичный ответ без приватных полей (PostgreSQL, см. tests/conftest.py)."""
import json
from datetime import datetime

import pytest

from backend import posters
from backend.models import MediaItem, Showcase

PUBLIC_ITEM_FIELDS = {
    "title_ru", "title_original", "category", "release_year", "genres", "country", "author", "rating", "poster", "finished_on",
}


def add_item(db, title="Фильм", rating=8, finished=datetime(2026, 3, 10, 12, 0), **over):
    data = {"title_ru": title, "category": "movie", "status": "completed", "rating": rating, "finished_at": finished}
    data.update(over)
    item = MediaItem(**data)
    db.add(item)
    db.commit()
    return item


def make(client, **over):
    body = {"title": "Мой топ", "category": "anime", "year": 2026, "month": 3, "max_items": 5}
    body.update(over)
    response = client.post("/showcases", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, **over):
    body = {"title": "Топ"}
    body.update(over)
    response = client.post("/showcases/preview", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def names(view):
    return [item["title_ru"] for item in view["items"]]


# --- управление ---

def test_create_builds_slug_from_parameters_and_is_private_by_default(client):
    created = make(client)
    assert created["slug"] == "top-anime-2026-03"
    assert created["is_public"] is False
    assert created["max_items"] == 5
    assert created["id"] == 1


def test_auto_slug_variants_and_suffix_for_taken(client):
    assert make(client, category=None, year=None, month=None)["slug"] == "top-all"
    assert make(client, category="tv_series", year=2025, month=None)["slug"] == "top-tv-series-2025"
    assert make(client, category="anime", year=2026, month=3)["slug"] == "top-anime-2026-03"
    assert make(client, category="anime", year=2026, month=3)["slug"] == "top-anime-2026-03-2"
    assert make(client, category="anime", year=2026, month=3)["slug"] == "top-anime-2026-03-3"


def test_create_with_explicit_slug_and_conflict(client):
    assert make(client, slug="my-favorites")["slug"] == "my-favorites"
    response = client.post("/showcases", json={"title": "Другая", "slug": "my-favorites"})
    assert response.status_code == 409
    assert "занят" in response.json()["detail"]


@pytest.mark.parametrize("slug", ["Top", "top_anime", "-top", "top-", "to p", "ab", "топ-аниме", "a" * 65, "top--x"])
def test_create_rejects_bad_slug(client, slug):
    assert client.post("/showcases", json={"title": "Т", "slug": slug}).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "т" * 121},
        {"title": "Т", "month": 3},  # месяц без года
        {"title": "Т", "year": 2026, "month": 13},
        {"title": "Т", "year": 1800},
        {"title": "Т", "max_items": 0},
        {"title": "Т", "max_items": 51},
        {"title": "Т", "category": "podcast"},
    ],
)
def test_create_validates_fields(client, body):
    assert client.post("/showcases", json=body).status_code == 422


def test_title_is_trimmed(client):
    assert make(client, title="  Мой топ  ")["title"] == "Мой топ"


def test_list_newest_first(client):
    make(client, title="Первая")
    make(client, title="Вторая", category="movie")
    assert [s["title"] for s in client.get("/showcases").json()] == ["Вторая", "Первая"]


def test_update_partial_and_clearing_fields(client):
    created = make(client)
    sid = created["id"]
    body = client.patch(f"/showcases/{sid}", json={"title": "Новое", "max_items": 3, "is_public": True}).json()
    assert (body["title"], body["max_items"], body["is_public"]) == ("Новое", 3, True)
    assert (body["category"], body["year"], body["month"]) == ("anime", 2026, 3)  # остальное не тронуто
    cleared = client.patch(f"/showcases/{sid}", json={"category": None, "month": None}).json()
    assert cleared["category"] is None and cleared["month"] is None and cleared["year"] == 2026
    assert client.patch(f"/showcases/{sid}", json={"year": None}).json()["year"] is None


def test_update_month_without_year_is_rejected_after_merge(client):
    sid = make(client, year=None, month=None)["id"]
    assert client.patch(f"/showcases/{sid}", json={"month": 5}).status_code == 422
    assert client.patch(f"/showcases/{sid}", json={"year": 2025, "month": 5}).status_code == 200
    assert client.patch(f"/showcases/{sid}", json={"year": None}).status_code == 422  # месяц остался бы без года


def test_update_slug_conflict_and_same_slug_is_fine(client):
    a = make(client, slug="aaa")
    make(client, slug="bbb")
    assert client.patch(f"/showcases/{a['id']}", json={"slug": "bbb"}).status_code == 409
    assert client.patch(f"/showcases/{a['id']}", json={"slug": "aaa"}).status_code == 200
    assert client.patch(f"/showcases/{a['id']}", json={"slug": "ccc"}).json()["slug"] == "ccc"


def test_update_rejects_null_for_required_fields(client):
    sid = make(client)["id"]
    for field in ("title", "max_items", "is_public", "slug"):
        assert client.patch(f"/showcases/{sid}", json={field: None}).status_code == 422, field


def test_update_and_delete_unknown_id_return_404(client):
    assert client.patch("/showcases/999", json={"title": "Т"}).status_code == 404
    assert client.delete("/showcases/999").status_code == 404


def test_delete(client):
    sid = make(client)["id"]
    assert client.delete(f"/showcases/{sid}").status_code == 204
    assert client.get("/showcases").json() == []


# --- выборка ---

def test_selection_takes_only_completed_rated_and_finished(client, db):
    add_item(db, "Подходит", 9)
    add_item(db, "Без оценки", None)
    add_item(db, "В процессе", 9, status="watching", finished_at=None)
    add_item(db, "Брошено", 9, status="dropped", finished_at=None)
    add_item(db, "В планах", None, status="planned", finished_at=None)
    assert names(preview(client)) == ["Подходит"]


def test_selection_sorted_by_rating_then_latest_finish(client, db):
    add_item(db, "Восемь старый", 8, finished=datetime(2026, 1, 5))
    add_item(db, "Десять", 10, finished=datetime(2026, 1, 1))
    add_item(db, "Восемь новый", 8, finished=datetime(2026, 2, 5))
    assert names(preview(client)) == ["Десять", "Восемь новый", "Восемь старый"]


def test_selection_respects_max_items(client, db):
    for i in range(6):
        add_item(db, f"Т{i}", 5 + i % 5)
    assert len(preview(client, max_items=4)["items"]) == 4
    assert len(preview(client)["items"]) == 6


def test_selection_filters_by_category(client, db):
    add_item(db, "Аниме", 9, category="anime")
    add_item(db, "Сериал", 9, category="tv_series")
    assert names(preview(client, category="anime")) == ["Аниме"]
    assert sorted(names(preview(client))) == ["Аниме", "Сериал"]


def test_selection_year_and_month_use_finished_at(client, db):
    add_item(db, "Конец 2025", 9, finished=datetime(2025, 12, 31, 23, 59, 59))
    add_item(db, "Начало 2026", 9, finished=datetime(2026, 1, 1, 0, 0, 0))
    add_item(db, "Март 2026", 9, finished=datetime(2026, 3, 15))
    add_item(db, "Март 2025", 9, finished=datetime(2025, 3, 15))
    assert sorted(names(preview(client, year=2026))) == ["Март 2026", "Начало 2026"]
    assert names(preview(client, year=2025, month=12)) == ["Конец 2025"]
    assert sorted(names(preview(client, year=2026, month=1))) == ["Начало 2026"]
    assert sorted(names(preview(client, year=None))) == ["Конец 2025", "Март 2025", "Март 2026", "Начало 2026"]
    assert preview(client, year=2024)["items"] == []


def test_preview_does_not_store_anything_and_uses_title_from_body(client, db):
    add_item(db, "Т", 9)
    view = preview(client, title="Черновик")
    assert view["title"] == "Черновик"
    assert client.get("/showcases").json() == []
    assert db.query(Showcase).count() == 0


def test_preview_validates_filter(client):
    assert client.post("/showcases/preview", json={"title": "Т", "month": 3}).status_code == 422
    assert client.post("/showcases/preview", json={"title": ""}).status_code == 422


# --- публичный ответ ---

def test_private_and_unknown_showcases_are_both_404(client, db):
    add_item(db, "Т", 9)
    make(client, slug="hidden", category=None, year=None, month=None)
    private = client.get("/public/showcases/hidden")
    unknown = client.get("/public/showcases/nothing-here")
    assert private.status_code == unknown.status_code == 404
    assert private.json() == unknown.json()  # по ответу не отличить, что витрина существует


def test_public_showcase_returns_items_after_publishing(client, db):
    add_item(db, "Т", 9, genres=["драма"], country="США", release_year=2020, author="Автор")
    sid = make(client, slug="open-top", category=None, year=None, month=None, title="Открытый топ")["id"]
    client.patch(f"/showcases/{sid}", json={"is_public": True})
    body = client.get("/public/showcases/open-top").json()
    assert body["title"] == "Открытый топ"
    assert body["items"][0] == {
        "title_ru": "Т", "title_original": None, "category": "movie", "release_year": 2020, "genres": ["драма"],
        "country": "США", "author": "Автор", "rating": 9, "poster": None, "finished_on": "2026-03-10",
    }


def test_disabling_showcase_hides_it_again(client, db):
    add_item(db, "Т", 9)
    sid = make(client, slug="toggle", category=None, year=None, month=None, is_public=True)["id"]
    assert client.get("/public/showcases/toggle").status_code == 200
    client.patch(f"/showcases/{sid}", json={"is_public": False})
    assert client.get("/public/showcases/toggle").status_code == 404
    client.patch(f"/showcases/{sid}", json={"is_public": True})
    assert client.get("/public/showcases/toggle").status_code == 200
    client.delete(f"/showcases/{sid}")
    assert client.get("/public/showcases/toggle").status_code == 404


def test_private_fields_do_not_leak(client, db):
    add_item(
        db, "Фильм", 9,
        comment="СЕКРЕТНАЯ ЗАМЕТКА", raw="СЫРАЯ СТРОКА", source_link="https://secret.example/link",
        translation="СЕКРЕТНАЯ ОЗВУЧКА", description="ЛИЧНОЕ ОПИСАНИЕ", current_episode=7, current_chapter=3, current_volume=2,
        total_episodes=12, poster_url="/posters/1.png",
    )
    make(client, slug="leak-check", category=None, year=None, month=None, is_public=True)
    response = client.get("/public/showcases/leak-check")
    text = json.dumps(response.json(), ensure_ascii=False)
    for secret in ("СЕКРЕТНАЯ", "СЫРАЯ", "secret.example", "ЛИЧНОЕ", "comment", "raw", "source_link", "translation", "description"):
        assert secret not in text, secret
    item = response.json()["items"][0]
    assert set(item) == PUBLIC_ITEM_FIELDS  # ровно разрешённые поля: ни id, ни прогресса, ни дат создания
    assert set(response.json()) == {"title", "category", "year", "month", "items"}  # ни id, ни slug, ни is_public


def test_showcase_item_schema_matches_whitelist():
    from backend.schemas import ShowcaseItem

    assert set(ShowcaseItem.model_fields) == PUBLIC_ITEM_FIELDS


def test_public_endpoints_require_api_key_when_set(client, db, monkeypatch):
    make(client, slug="keyed", category=None, year=None, month=None, is_public=True)
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/public/showcases/keyed").status_code == 401
    assert client.get("/public/showcases/keyed", headers={"X-API-Key": "secret"}).status_code == 200


# --- постеры ---

@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


def write_poster(directory, name, content=b"\x89PNG\r\n\x1a\nbody"):
    (directory / name).write_bytes(content)


def test_poster_urls_are_rewritten_to_public_addresses(client, db, posters_dir):
    local = add_item(db, "Локальный", 9, poster_url="/posters/1.png")
    add_item(db, "Внешний", 8, poster_url="https://image.tmdb.org/t/p/w500/x.jpg")
    add_item(db, "Странный", 7, poster_url="file:///etc/passwd")
    add_item(db, "Без постера", 6, poster_url=None)
    make(client, slug="posters", category=None, year=None, month=None, is_public=True)
    items = {i["title_ru"]: i["poster"] for i in client.get("/public/showcases/posters").json()["items"]}
    assert items["Локальный"] == f"/public/showcases/posters/posters/{local.id}.png"
    assert items["Внешний"] == "https://image.tmdb.org/t/p/w500/x.jpg"
    assert items["Странный"] is None
    assert items["Без постера"] is None


def test_preview_keeps_library_poster_path(client, db):
    add_item(db, "Т", 9, poster_url="/posters/1.png")
    assert preview(client)["items"][0]["poster"] == "/posters/1.png"


def test_public_poster_is_served_for_showcase_items(client, db, posters_dir):
    item = add_item(db, "Т", 9, poster_url="/posters/1.png")
    write_poster(posters_dir, "1.png")
    make(client, slug="pst-1", category=None, year=None, month=None, is_public=True)
    response = client.get(f"/public/showcases/pst-1/posters/{item.id}.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_public_poster_of_other_items_is_not_served(client, db, posters_dir):
    inside = add_item(db, "В витрине", 9, poster_url="/posters/1.png")
    outside = add_item(db, "Не в витрине", 3, poster_url="/posters/2.png")
    write_poster(posters_dir, "1.png")
    write_poster(posters_dir, "2.png")
    make(client, slug="pst-2", category=None, year=None, month=None, max_items=1, is_public=True)
    assert client.get(f"/public/showcases/pst-2/posters/{inside.id}.png").status_code == 200
    assert client.get(f"/public/showcases/pst-2/posters/{outside.id}.png").status_code == 404  # вышла за max_items


def test_public_poster_of_private_showcase_is_404(client, db, posters_dir):
    item = add_item(db, "Т", 9, poster_url="/posters/1.png")
    write_poster(posters_dir, "1.png")
    make(client, slug="pst-3", category=None, year=None, month=None, is_public=False)
    assert client.get(f"/public/showcases/pst-3/posters/{item.id}.png").status_code == 404


def test_public_poster_stops_working_when_item_leaves_showcase(client, db, posters_dir):
    item = add_item(db, "Т", 9, poster_url="/posters/1.png")
    write_poster(posters_dir, "1.png")
    make(client, slug="pst-4", category=None, year=None, month=None, is_public=True)
    assert client.get("/public/showcases/pst-4/posters/1.png").status_code == 200
    item.rating = None
    db.commit()
    assert client.get("/public/showcases/pst-4/posters/1.png").status_code == 404


@pytest.mark.parametrize("filename", ["..%2F..%2Fsecret.png", "%2e%2e%2f1.png", "1.txt", "1.png%00.png", "secret.env", ".png"])
def test_public_poster_rejects_unexpected_filenames(client, db, posters_dir, filename):
    add_item(db, "Т", 9, poster_url="/posters/1.png")
    write_poster(posters_dir, "1.png")
    (posters_dir.parent / "secret.png").write_bytes(b"x")
    make(client, slug="pst-5", category=None, year=None, month=None, is_public=True)
    assert client.get(f"/public/showcases/pst-5/posters/{filename}").status_code == 404


def test_public_poster_missing_file_is_404(client, db, posters_dir):
    add_item(db, "Т", 9, poster_url="/posters/1.png")  # записи есть, файла нет
    make(client, slug="pst-6", category=None, year=None, month=None, is_public=True)
    assert client.get("/public/showcases/pst-6/posters/1.png").status_code == 404


def test_poster_file_helper():
    from backend.showcase import poster_file

    assert poster_file("/posters/42.jpg") == "42.jpg"
    for bad in (None, "", "https://x/y.jpg", "/posters/", "/posters/../x.png", "/posters/a/b.png", "posters/1.png"):
        assert poster_file(bad) is None, bad
