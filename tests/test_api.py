"""Тесты API на настоящей PostgreSQL (см. tests/conftest.py)."""
from datetime import datetime


def make_item(**overrides):
    data = {
        "title_ru": "Блудливая Калифорния",
        "title_original": "Californication",
        "category": "tv_series",
        "genres": ["драма", "комедия"],
        "country": "США",
        "release_year": 2007,
        "current_season": 7,
        "current_episode": 5,
    }
    data.update(overrides)
    return data


def create(client, **overrides):
    response = client.post("/items/", json=make_item(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def titles(response):
    assert response.status_code == 200, response.text
    return [item["title_ru"] for item in response.json()]


def test_create_and_get(client):
    created = create(client)
    assert created["id"] == 1
    assert created["status"] == "planned"
    assert created["current_volume"] is None
    assert created["current_chapter"] is None

    response = client.get(f"/items/{created['id']}")
    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_returns_404(client):
    response = client.get("/items/999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Элемент не найден"}


def test_filter_by_category(client):
    create(client, title_ru="Сериал", title_original="Series")
    create(client, title_ru="Аниме", title_original="Anime", category="anime")
    assert titles(client.get("/items/", params={"category": "anime"})) == ["Аниме"]


def test_filter_by_status(client):
    create(client, title_ru="Планы", title_original="Plans")
    create(client, title_ru="Смотрю", title_original="Watching", status="watching")
    assert titles(client.get("/items/", params={"status": "watching"})) == ["Смотрю"]


def test_filter_by_genre_ignores_case(client):
    create(client, title_ru="Драма-шоу", title_original="Drama", genres=["драма"])
    create(client, title_ru="Комедия-шоу", title_original="Comedy", genres=["комедия"])
    assert titles(client.get("/items/", params={"genre": "Драма"})) == ["Драма-шоу"]
    assert titles(client.get("/items/", params={"genre": "драма"})) == ["Драма-шоу"]


def test_search_by_original_title_ignores_case(client):
    create(client)
    create(client, title_ru="Другое", title_original="Other")
    assert titles(client.get("/items/", params={"q": "CALIFORN"})) == ["Блудливая Калифорния"]


def test_search_by_russian_title(client):
    create(client)
    assert titles(client.get("/items/", params={"q": "блудливая"})) == ["Блудливая Калифорния"]


def test_search_treats_percent_as_plain_character(client):
    create(client)
    assert titles(client.get("/items/", params={"q": "%"})) == []


def test_list_sorted_by_updated_at_desc(client):
    first = create(client, title_ru="Первый", title_original="First")
    create(client, title_ru="Второй", title_original="Second")
    assert titles(client.get("/items/")) == ["Второй", "Первый"]

    client.patch(f"/items/{first['id']}", json={"current_episode": 6})
    assert titles(client.get("/items/")) == ["Первый", "Второй"]


def test_patch_changes_only_given_fields(client):
    created = create(client, rating=5, comment="неплохо")

    response = client.patch(f"/items/{created['id']}", json={"current_episode": 6})
    assert response.status_code == 200
    updated = response.json()

    assert updated["current_episode"] == 6
    for field in ("title_ru", "category", "genres", "rating", "comment", "current_season"):
        assert updated[field] == created[field]


def test_patch_can_clear_optional_field(client):
    created = create(client, rating=5)
    response = client.patch(f"/items/{created['id']}", json={"rating": None})
    assert response.status_code == 200
    assert response.json()["rating"] is None


def test_patch_updates_updated_at(client):
    created = create(client)
    response = client.patch(f"/items/{created['id']}", json={"rating": 9})
    updated = response.json()

    assert datetime.fromisoformat(updated["updated_at"]) > datetime.fromisoformat(created["updated_at"])
    assert updated["created_at"] == created["created_at"]


def test_patch_missing_returns_404(client):
    assert client.patch("/items/999", json={"rating": 9}).status_code == 404


def test_patch_null_in_required_field_returns_422(client):
    created = create(client)
    response = client.patch(f"/items/{created['id']}", json={"title_ru": None})
    assert response.status_code == 422


def test_create_with_invalid_category_returns_422(client):
    response = client.post("/items/", json=make_item(category="podcast"))
    assert response.status_code == 422


def test_create_with_rating_11_returns_422(client):
    response = client.post("/items/", json=make_item(rating=11))
    assert response.status_code == 422


def test_patch_with_rating_11_returns_422(client):
    created = create(client)
    response = client.patch(f"/items/{created['id']}", json={"rating": 11})
    assert response.status_code == 422
    assert client.get(f"/items/{created['id']}").json()["rating"] is None


def test_delete_then_get_returns_404(client):
    created = create(client)
    assert client.delete(f"/items/{created['id']}").status_code == 204
    assert client.get(f"/items/{created['id']}").status_code == 404


def test_delete_missing_returns_404(client):
    assert client.delete("/items/999").status_code == 404


def test_health_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
