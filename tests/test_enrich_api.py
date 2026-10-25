"""Тесты ручного выбора кандидатов: провайдер подменяется через dependency_overrides, сеть не используется."""
import httpx
import pytest

from backend import posters
from backend.enrich.base import (
    Candidate,
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    UnsupportedCategoryError,
)
from backend.enrich.registry import Enricher
from backend.main import app, get_enricher
from backend.models import MediaItem

PNG = b"\x89PNG\r\n\x1a\n" + b"png-data"
JPG = b"\xff\xd8\xff\xe0" + b"jpg-data"


def candidate(external_id="1", **overrides):
    data = {
        "source": "fake", "external_id": external_id, "title": "Блудливая Калифорния",
        "original_title": "Californication", "year": 2007, "poster_url": "https://img.example/poster.png",
        "genres": ["драма", "комедия"], "country": "США", "author": None,
    }
    data.update(overrides)
    return Candidate(**data)


class FakeProvider:
    source = "fake"

    def __init__(self, candidates=None, error=None):
        self.candidates = candidates if candidates is not None else [candidate("1"), candidate("2", title="Другая")]
        self.error = error
        self.searched = []

    def search(self, item):
        self.searched.append(item.title_ru)
        if self.error:
            raise self.error
        return self.candidates


class FakeProviderWithDetails(FakeProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.detail_calls = 0

    def fill_details(self, c):
        self.detail_calls += 1
        return Candidate(**{**c.__dict__, "genres": ["подробный жанр"]})


class FakeEnricher:
    def __init__(self, provider=None, error=None, download=None):
        self.provider = provider or FakeProvider()
        self.error = error
        self.downloads = []
        self._download = download or (lambda url: (PNG, "image/png"))

    def provider_for(self, category):
        if self.error:
            raise self.error
        return self.provider

    def download(self, url):
        self.downloads.append(url)
        return self._download(url)


@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def use_enricher(client):
    """Подставляет заглушку вместо настоящих провайдеров (override сбрасывает фикстура client)."""

    def install(enricher=None, **kwargs):
        enricher = enricher or FakeEnricher(**kwargs)
        app.dependency_overrides[get_enricher] = lambda: enricher
        return enricher

    return install


def create_item(client, **overrides):
    data = {"title_ru": "Блудливая Калифорния", "title_original": "Californication", "category": "tv_series",
            "release_year": 2007}
    data.update(overrides)
    response = client.post("/items/", json=data)
    assert response.status_code == 201, response.text
    return response.json()


def names(directory):
    return sorted(path.name for path in directory.iterdir())


# --- GET /items/{id}/enrich/candidates ---

def test_candidates_returns_list_without_saving(client, use_enricher, posters_dir):
    item = create_item(client)
    enricher = use_enricher()

    response = client.get(f"/items/{item['id']}/enrich/candidates")

    assert response.status_code == 200
    body = response.json()
    assert [c["external_id"] for c in body] == ["1", "2"]
    assert body[0] == {
        "source": "fake", "external_id": "1", "title": "Блудливая Калифорния", "original_title": "Californication",
        "year": 2007, "poster_url": "https://img.example/poster.png", "genres": ["драма", "комедия"],
        "country": "США", "author": None,
    }
    assert enricher.provider.searched == ["Блудливая Калифорния"]
    # ничего не сохранено: ни в карточке, ни на диске, ничего не скачано
    assert client.get(f"/items/{item['id']}").json() == item
    assert names(posters_dir) == []
    assert enricher.downloads == []


def test_candidates_empty_list(client, use_enricher):
    item = create_item(client)
    use_enricher(provider=FakeProvider(candidates=[]))
    response = client.get(f"/items/{item['id']}/enrich/candidates")
    assert response.status_code == 200
    assert response.json() == []


def test_candidates_for_missing_item_returns_404(client, use_enricher):
    use_enricher()
    assert client.get("/items/999/enrich/candidates").status_code == 404


# --- ошибки внешнего API: 502/503, а не 500 ---

@pytest.mark.parametrize(
    "error, status_code, text",
    [
        (ProviderConfigError("Не задан TMDB_API_KEY."), 503, "TMDB_API_KEY"),
        (ProviderAuthError("TMDB не принял ключ (401)"), 503, "не принял ключ"),
        (httpx.ReadTimeout("timeout"), 502, "не ответил вовремя"),
        (httpx.ConnectError("нет сети"), 502, "Не удалось связаться"),
        (ProviderError("что-то пошло не так"), 502, "что-то пошло не так"),
        (UnsupportedCategoryError("Для категории «x» обогащение не поддерживается"), 400, "не поддерживается"),
        (KeyError("id"), 502, "неожиданный ответ"),
        (ValueError("не JSON"), 502, "неожиданный ответ"),
    ],
)
def test_candidates_maps_external_errors(client, use_enricher, error, status_code, text):
    item = create_item(client)
    use_enricher(provider=FakeProvider(error=error))

    response = client.get(f"/items/{item['id']}/enrich/candidates")

    assert response.status_code == status_code
    assert text in response.json()["detail"]


def test_candidates_maps_http_status_error(client, use_enricher):
    item = create_item(client)
    failing = httpx.HTTPStatusError(
        "boom", request=httpx.Request("GET", "https://api.example"), response=httpx.Response(500)
    )
    use_enricher(provider=FakeProvider(error=failing))

    response = client.get(f"/items/{item['id']}/enrich/candidates")

    assert response.status_code == 502
    assert "500" in response.json()["detail"]


def test_candidates_provider_not_configured(client, use_enricher):
    item = create_item(client)
    use_enricher(error=ProviderConfigError("Не задан SHIKIMORI_USER_AGENT."))
    response = client.get(f"/items/{item['id']}/enrich/candidates")
    assert response.status_code == 503
    assert "SHIKIMORI_USER_AGENT" in response.json()["detail"]


# --- POST /items/{id}/enrich/apply ---

def apply(client, item_id, external_id="1", source="fake", **params):
    return client.post(
        f"/items/{item_id}/enrich/apply", params=params, json={"source": source, "external_id": external_id}
    )


def test_apply_fills_empty_fields_and_saves_poster(client, use_enricher, posters_dir):
    item = create_item(client, release_year=None)
    enricher = use_enricher()

    response = apply(client, item["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body["changed"]) == {"poster_url", "genres", "country", "release_year"}
    saved = body["item"]
    assert saved["poster_url"] == f"/posters/{item['id']}.png"
    assert saved["genres"] == ["драма", "комедия"]
    assert saved["country"] == "США"
    assert saved["release_year"] == 2007
    assert (posters_dir / f"{item['id']}.png").read_bytes() == PNG
    assert enricher.downloads == ["https://img.example/poster.png"]
    assert client.get(f"/items/{item['id']}").json()["poster_url"] == f"/posters/{item['id']}.png"


def test_apply_picks_the_chosen_candidate(client, use_enricher, posters_dir):
    item = create_item(client)
    use_enricher(provider=FakeProvider([candidate("1", country="США"), candidate("2", country="Канада")]))

    assert apply(client, item["id"], external_id="2").json()["item"]["country"] == "Канада"


def test_apply_never_overwrites_filled_fields(client, use_enricher, posters_dir):
    item = create_item(
        client, poster_url="https://example.com/mine.jpg", genres=["мои жанры"], country="Моя страна", release_year=1999
    )
    enricher = use_enricher()

    response = apply(client, item["id"])

    assert response.status_code == 200
    assert response.json()["changed"] == []
    saved = client.get(f"/items/{item['id']}").json()
    assert (saved["poster_url"], saved["genres"], saved["country"], saved["release_year"]) == (
        "https://example.com/mine.jpg", ["мои жанры"], "Моя страна", 1999,
    )
    assert enricher.downloads == []  # постер уже есть: не скачиваем
    assert names(posters_dir) == []


def test_apply_without_force_keeps_existing_local_poster(client, use_enricher, posters_dir):
    item = create_item(client)
    posters.save_poster(item["id"], JPG, "image/jpeg")
    client.patch(f"/items/{item['id']}", json={"poster_url": f"/posters/{item['id']}.jpg"})
    use_enricher()

    apply(client, item["id"])

    assert names(posters_dir) == [f"{item['id']}.jpg"]
    assert client.get(f"/items/{item['id']}").json()["poster_url"] == f"/posters/{item['id']}.jpg"


def test_apply_force_replaces_poster_only(client, use_enricher, posters_dir):
    item = create_item(client, genres=["мои жанры"], country="Моя страна")
    posters.save_poster(item["id"], JPG, "image/jpeg")
    client.patch(f"/items/{item['id']}", json={"poster_url": f"/posters/{item['id']}.jpg"})
    use_enricher()

    response = apply(client, item["id"], force="true")

    assert response.status_code == 200, response.text
    body = response.json()
    assert "poster_url" in body["changed"]
    assert body["item"]["poster_url"] == f"/posters/{item['id']}.png"
    assert names(posters_dir) == [f"{item['id']}.png"]  # старый .jpg удалён
    # force касается только постера: остальное не перезаписывается
    assert body["item"]["genres"] == ["мои жанры"]
    assert body["item"]["country"] == "Моя страна"


def test_apply_force_replaces_external_poster_url(client, use_enricher, posters_dir):
    item = create_item(client, poster_url="https://example.com/old.jpg")
    use_enricher()

    saved = apply(client, item["id"], force="true").json()["item"]

    assert saved["poster_url"] == f"/posters/{item['id']}.png"


def test_apply_force_without_candidate_poster_keeps_current(client, use_enricher, posters_dir):
    item = create_item(client, poster_url="https://example.com/old.jpg")
    enricher = use_enricher(provider=FakeProvider([candidate("1", poster_url=None)]))

    saved = apply(client, item["id"], force="true").json()["item"]

    assert saved["poster_url"] == "https://example.com/old.jpg"
    assert enricher.downloads == []


def test_apply_uses_details_for_missing_genres(client, use_enricher, posters_dir):
    item = create_item(client)
    provider = FakeProviderWithDetails([candidate("1", genres=[])])
    use_enricher(provider=provider)

    saved = apply(client, item["id"]).json()["item"]

    assert provider.detail_calls == 1
    assert saved["genres"] == ["подробный жанр"]


def test_apply_skips_details_when_genres_known(client, use_enricher, posters_dir):
    item = create_item(client, genres=["мои жанры"])
    provider = FakeProviderWithDetails([candidate("1", genres=[])])
    use_enricher(provider=provider)

    apply(client, item["id"])

    assert provider.detail_calls == 0


def test_apply_unknown_candidate_returns_404(client, use_enricher, posters_dir):
    item = create_item(client)
    use_enricher()

    response = apply(client, item["id"], external_id="nope")

    assert response.status_code == 404
    assert "Кандидат не найден" in response.json()["detail"]


def test_apply_wrong_source_returns_400(client, use_enricher, posters_dir):
    item = create_item(client)
    use_enricher()

    response = apply(client, item["id"], source="tmdb")

    assert response.status_code == 400
    assert "не подходит" in response.json()["detail"]


def test_apply_for_missing_item_returns_404(client, use_enricher):
    use_enricher()
    assert apply(client, 999).status_code == 404


def test_apply_requires_source_and_external_id(client, use_enricher):
    item = create_item(client)
    use_enricher()
    assert client.post(f"/items/{item['id']}/enrich/apply", json={}).status_code == 422
    assert client.post(f"/items/{item['id']}/enrich/apply", json={"source": "fake"}).status_code == 422
    assert client.post(f"/items/{item['id']}/enrich/apply", json={"source": "", "external_id": "1"}).status_code == 422


@pytest.mark.parametrize(
    "error, status_code",
    [
        (ProviderConfigError("Не задан TMDB_API_KEY."), 503),
        (httpx.ReadTimeout("timeout"), 502),
    ],
)
def test_apply_maps_search_errors(client, use_enricher, posters_dir, error, status_code):
    item = create_item(client)
    use_enricher(provider=FakeProvider(error=error))
    assert apply(client, item["id"]).status_code == status_code


def test_apply_provider_not_configured(client, use_enricher, posters_dir):
    item = create_item(client)
    use_enricher(error=ProviderConfigError("Не задан TMDB_API_KEY."))

    response = apply(client, item["id"])

    assert response.status_code == 503
    assert "TMDB_API_KEY" in response.json()["detail"]


def test_apply_download_failure_saves_nothing(client, use_enricher, posters_dir):
    item = create_item(client, release_year=None)

    def broken(url):
        raise httpx.ReadTimeout("картинка не скачалась")

    use_enricher(download=broken)

    response = apply(client, item["id"])

    assert response.status_code == 502
    assert "не ответил вовремя" in response.json()["detail"]
    saved = client.get(f"/items/{item['id']}").json()
    assert saved["poster_url"] is None
    assert saved["genres"] == []  # частично ничего не применяется
    assert saved["release_year"] is None
    assert names(posters_dir) == []


def test_apply_rejects_non_image_poster(client, use_enricher, posters_dir):
    item = create_item(client)
    use_enricher(download=lambda url: (b"<html>not an image</html>", "text/html"))

    response = apply(client, item["id"])

    assert response.status_code == 502
    assert "непригодный как постер" in response.json()["detail"]
    assert client.get(f"/items/{item['id']}").json()["poster_url"] is None
    assert names(posters_dir) == []


# --- Enricher (без БД) ---

class StubProviderA:
    categories = frozenset({"anime"})
    source = "a"
    image_hosts = ("a.example",)
    created = 0

    def __init__(self):
        type(self).created += 1
        self.fetcher = type("F", (), {"closed": False, "close": lambda self: setattr(self, "closed", True)})()


class StubProviderB:
    categories = frozenset({"book"})
    source = "b"
    image_hosts = ("b.example",)

    def __init__(self):
        raise ProviderConfigError("B не настроен")


def test_enricher_picks_provider_by_category_and_reuses_it():
    StubProviderA.created = 0
    enricher = Enricher(provider_classes=(StubProviderA, StubProviderB))

    first = enricher.provider_for("anime")
    assert enricher.provider_for("anime") is first
    assert StubProviderA.created == 1


def test_enricher_reports_missing_configuration():
    enricher = Enricher(provider_classes=(StubProviderA, StubProviderB))
    with pytest.raises(ProviderConfigError, match="B не настроен"):
        enricher.provider_for("book")


def test_enricher_unknown_category():
    enricher = Enricher(provider_classes=(StubProviderA,))
    with pytest.raises(UnsupportedCategoryError, match="не поддерживается"):
        enricher.provider_for("movie")


def test_enricher_close_closes_fetchers():
    enricher = Enricher(provider_classes=(StubProviderA,))
    provider = enricher.provider_for("anime")
    enricher.close()
    assert provider.fetcher.closed


def test_default_enricher_covers_all_categories():
    from backend.enrich.registry import ALL_CATEGORIES

    assert ALL_CATEGORIES == {"tv_series", "tv_show", "cartoon", "movie", "anime", "manga", "book", "audiobook"}
