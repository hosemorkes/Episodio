"""Тесты поиска по каталогу и добавления из него: провайдеры подменяются заглушками, сеть не используется."""
import httpx
import pytest

from backend import catalog, posters
from backend.enrich.base import Candidate, ProviderAuthError, ProviderConfigError, ProviderError
from backend.main import app, get_enricher
from backend.models import ProgressLog

PNG = b"\x89PNG\r\n\x1a\n" + b"png-data"


def candidate(external_id="1", **overrides):
    data = {
        "source": "fake", "external_id": external_id, "title": "Фрирен", "original_title": "Sousou no Frieren",
        "year": 2023, "poster_url": "https://img.example/frieren.png", "genres": ["фэнтези", "драма"],
        "country": None, "author": None,
    }
    data.update(overrides)
    return Candidate(**data)


class FakeProvider:
    source = "fake"

    def __init__(self, candidates=None, error=None):
        self.candidates = candidates if candidates is not None else [candidate("1"), candidate("2", title="Другое")]
        self.error = error
        self.queries = []

    def search(self, item):
        self.queries.append((item.title_original, item.title_ru, item.release_year, item.category))
        if self.error:
            raise self.error
        return self.candidates


class FakeProviderWithDetails(FakeProvider):
    def fill_details(self, c):
        return Candidate(**{**c.__dict__, "genres": ["подробный жанр"]})


class FakeEnricher:
    """Провайдер на каждую категорию: словарь {категория: провайдер или исключение}."""

    def __init__(self, providers=None, default=None, download=None):
        self.providers = providers or {}
        self.default = default if default is not None else FakeProvider()
        self.asked = []
        self.downloads = []
        self._download = download or (lambda url: (PNG, "image/png"))

    def provider_for(self, category, source=None):
        self.asked.append(category)
        provider = self.providers.get(category, self.default)
        if isinstance(provider, Exception):
            raise provider
        return provider

    def download(self, url):
        self.downloads.append(url)
        return self._download(url)


@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def use_enricher(client):
    def install(enricher=None, **kwargs):
        enricher = enricher or FakeEnricher(**kwargs)
        app.dependency_overrides[get_enricher] = lambda: enricher
        return enricher

    return install


def add_body(**overrides):
    data = {
        "source": "fake", "external_id": "1", "category": "anime", "title": "Фрирен",
        "original_title": "Sousou no Frieren", "year": 2023, "poster_url": "https://img.example/frieren.png",
        "genres": ["Фэнтези", "Драма"], "country": "Япония",
    }
    data.update(overrides)
    return data


# --- GET /catalog/search ---

def test_search_one_category(client, use_enricher):
    enricher = use_enricher()
    response = client.get("/catalog/search", params={"q": "Фрирен", "category": "anime"})
    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert [r["external_id"] for r in body["results"]] == ["1", "2"]
    assert body["results"][0] == {
        "source": "fake", "external_id": "1", "category": "anime", "title": "Фрирен",
        "original_title": "Sousou no Frieren", "year": 2023, "poster_url": "https://img.example/frieren.png",
        "genres": ["фэнтези", "драма"], "country": None, "author": None, "rating": None,
    }
    assert enricher.asked == ["anime"]


def test_search_passes_query_as_titles(client, use_enricher):
    enricher = use_enricher()
    client.get("/catalog/search", params={"q": "  Frieren  ", "category": "anime"})
    assert enricher.default.queries == [("Frieren", "Frieren", None, "anime")]


def test_search_without_category_uses_main_categories(client, use_enricher):
    enricher = use_enricher()
    response = client.get("/catalog/search", params={"q": "Dune"})
    assert response.status_code == 200
    assert enricher.asked == list(catalog.DEFAULT_CATEGORIES)
    assert {r["category"] for r in response.json()["results"]} == set(catalog.DEFAULT_CATEGORIES)


def test_search_limit_per_category(client, use_enricher):
    use_enricher(default=FakeProvider([candidate(str(i)) for i in range(15)]))
    results = client.get("/catalog/search", params={"q": "Dune", "category": "book", "limit": 3}).json()["results"]
    assert len(results) == 3


def test_search_removes_duplicates(client, use_enricher):
    use_enricher(default=FakeProvider([candidate("1"), candidate("1")]))
    assert len(client.get("/catalog/search", params={"q": "Dune", "category": "anime"}).json()["results"]) == 1


def test_search_skips_unavailable_source_and_reports_it(client, use_enricher):
    use_enricher(
        providers={
            "tv_series": ProviderConfigError("Не задан TMDB_API_KEY"),
            "movie": ProviderConfigError("Не задан TMDB_API_KEY"),
        }
    )
    body = client.get("/catalog/search", params={"q": "Dune"}).json()
    assert {r["category"] for r in body["results"]} == {"anime", "manga", "book"}
    assert len(body["errors"]) == 1
    assert "TMDB_API_KEY" in body["errors"][0]


def test_search_partial_timeout_is_reported(client, use_enricher):
    use_enricher(providers={"book": FakeProvider(error=httpx.ReadTimeout("slow"))})
    body = client.get("/catalog/search", params={"q": "Dune"}).json()
    assert body["results"]
    assert body["errors"] == ["Внешний сервис не ответил вовремя, попробуй позже"]


def test_search_single_category_failure_returns_503_or_502(client, use_enricher):
    use_enricher(default=FakeProvider(error=ProviderConfigError("нет ключа")))
    response = client.get("/catalog/search", params={"q": "Dune", "category": "movie"})
    assert response.status_code == 503
    assert "нет ключа" in response.json()["detail"]

    use_enricher(default=FakeProvider(error=httpx.ConnectError("down")))
    assert client.get("/catalog/search", params={"q": "Dune", "category": "movie"}).status_code == 502

    use_enricher(default=FakeProvider(error=ProviderAuthError("ключ не принят")))
    assert client.get("/catalog/search", params={"q": "Dune", "category": "movie"}).status_code == 503


def test_search_all_sources_failed_returns_error(client, use_enricher):
    use_enricher(default=FakeProvider(error=httpx.ConnectError("down")))
    assert client.get("/catalog/search", params={"q": "Dune"}).status_code == 502


def test_search_empty_result_is_not_an_error(client, use_enricher):
    use_enricher(default=FakeProvider(candidates=[]))
    response = client.get("/catalog/search", params={"q": "ничего", "category": "anime"})
    assert response.status_code == 200
    assert response.json() == {"results": [], "errors": []}


def test_search_validates_params(client, use_enricher):
    use_enricher()
    assert client.get("/catalog/search").status_code == 422
    assert client.get("/catalog/search", params={"q": "a"}).status_code == 422
    assert client.get("/catalog/search", params={"q": "Dune", "category": "podcast"}).status_code == 422
    assert client.get("/catalog/search", params={"q": "Dune", "limit": 21}).status_code == 422


# --- POST /items/from-catalog ---

def test_add_from_catalog_creates_item_with_poster(client, use_enricher, posters_dir):
    enricher = use_enricher()
    response = client.post("/items/from-catalog", json=add_body(status="watching"))
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["id"] == 1
    assert item["title_ru"] == "Фрирен"
    assert item["title_original"] == "Sousou no Frieren"
    assert item["category"] == "anime"
    assert item["status"] == "watching"
    assert item["release_year"] == 2023
    assert item["country"] == "Япония"
    assert item["genres"] == ["фэнтези", "драма"]
    assert item["poster_url"] == "/posters/1.png"
    assert (posters_dir / "1.png").read_bytes() == PNG
    assert enricher.downloads == ["https://img.example/frieren.png"]
    assert client.get("/items/1").json() == item


def test_add_from_catalog_default_status_is_planned(client, use_enricher, posters_dir):
    use_enricher()
    assert client.post("/items/from-catalog", json=add_body()).json()["status"] == "planned"


def test_add_from_catalog_without_poster(client, use_enricher, posters_dir):
    enricher = use_enricher()
    item = client.post("/items/from-catalog", json=add_body(poster_url=None)).json()
    assert item["poster_url"] is None
    assert enricher.downloads == []


def test_add_from_catalog_poster_failure_still_creates_item(client, use_enricher, posters_dir):
    def broken(url):
        raise ProviderError("Неизвестный источник картинки")

    use_enricher(download=broken)
    response = client.post("/items/from-catalog", json=add_body())
    assert response.status_code == 201
    assert response.json()["poster_url"] is None
    assert list(posters_dir.iterdir()) == []


def test_add_from_catalog_bad_poster_file_still_creates_item(client, use_enricher, posters_dir):
    use_enricher(download=lambda url: (b"not an image", "image/png"))
    response = client.post("/items/from-catalog", json=add_body())
    assert response.status_code == 201
    assert response.json()["poster_url"] is None


def test_add_from_catalog_fetches_genres_when_missing(client, use_enricher, posters_dir):
    use_enricher(default=FakeProviderWithDetails())
    item = client.post("/items/from-catalog", json=add_body(genres=[])).json()
    assert item["genres"] == ["подробный жанр"]


def test_add_from_catalog_keeps_given_genres(client, use_enricher, posters_dir):
    use_enricher(default=FakeProviderWithDetails())
    assert client.post("/items/from-catalog", json=add_body()).json()["genres"] == ["фэнтези", "драма"]


def test_add_from_catalog_details_error_is_ignored(client, use_enricher, posters_dir):
    class Broken(FakeProviderWithDetails):
        def fill_details(self, c):
            raise httpx.ReadTimeout("slow")

    use_enricher(default=Broken())
    response = client.post("/items/from-catalog", json=add_body(genres=[]))
    assert response.status_code == 201
    assert response.json()["genres"] == []


def test_add_from_catalog_duplicate_returns_409(client, use_enricher, posters_dir):
    use_enricher()
    assert client.post("/items/from-catalog", json=add_body()).status_code == 201
    response = client.post("/items/from-catalog", json=add_body(title="ФРИРЕН", original_title="sousou no frieren"))
    assert response.status_code == 409
    assert "Уже в библиотеке" in response.json()["detail"]
    assert len(client.get("/items/").json()) == 1


def test_add_from_catalog_same_title_other_category_is_not_duplicate(client, use_enricher, posters_dir):
    use_enricher()
    client.post("/items/from-catalog", json=add_body())
    assert client.post("/items/from-catalog", json=add_body(category="manga")).status_code == 201


def test_add_from_catalog_duplicate_of_manual_item(client, use_enricher, posters_dir):
    use_enricher()
    client.post("/items/", json={"title_ru": "Фрирен", "title_original": "Sousou no Frieren", "category": "anime"})
    assert client.post("/items/from-catalog", json=add_body()).status_code == 409


def test_add_from_catalog_wrong_source_returns_400(client, use_enricher, posters_dir):
    use_enricher()
    response = client.post("/items/from-catalog", json=add_body(source="tmdb"))
    assert response.status_code == 400
    assert "fake" in response.json()["detail"]


def test_add_from_catalog_unconfigured_provider_returns_503(client, use_enricher, posters_dir):
    use_enricher(providers={"anime": ProviderConfigError("Не задан SHIKIMORI_USER_AGENT")})
    response = client.post("/items/from-catalog", json=add_body())
    assert response.status_code == 503


def test_add_from_catalog_validates_body(client, use_enricher):
    use_enricher()
    assert client.post("/items/from-catalog", json=add_body(category="podcast")).status_code == 422
    assert client.post("/items/from-catalog", json=add_body(title="")).status_code == 422
    assert client.post("/items/from-catalog", json=add_body(status="finished")).status_code == 422
    assert client.post("/items/from-catalog", json={}).status_code == 422


def test_add_movie_as_completed_writes_log(client, use_enricher, posters_dir, db):
    use_enricher()
    response = client.post("/items/from-catalog", json=add_body(category="movie", status="completed"))
    assert response.status_code == 201
    assert response.json()["finished_at"] is not None
    entry = db.query(ProgressLog).one()
    assert (entry.unit, entry.number) == ("movie", 1)


def test_add_from_catalog_does_not_clash_with_item_routes(client, use_enricher, posters_dir):
    use_enricher()
    assert client.post("/items/from-catalog", json=add_body()).status_code == 201
    assert client.get("/items/1").status_code == 200


# --- X-API-Key ---

def test_catalog_endpoints_require_api_key(client, use_enricher, posters_dir, monkeypatch):
    use_enricher()
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/catalog/search", params={"q": "Dune"}).status_code == 401
    assert client.post("/items/from-catalog", json=add_body()).status_code == 401
    headers = {"X-API-Key": "secret"}
    assert client.get("/catalog/search", params={"q": "Dune", "category": "anime"}, headers=headers).status_code == 200
    assert client.post("/items/from-catalog", json=add_body(), headers=headers).status_code == 201
