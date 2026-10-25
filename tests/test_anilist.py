"""Тесты AniList: GraphQL-провайдер, выбор источника в реестре и в API. Сеть не используется."""
import json

import httpx
import pytest

from backend.enrich.anilist import API_URL, AniListError, AniListProvider, GENRES, translate_genres
from backend.enrich.base import Candidate, ProviderConfigError, UnsupportedCategoryError
from backend.enrich.client import HttpFetcher
from backend.enrich.registry import Enricher, PROVIDER_CLASSES, categories_of, sources_for
from backend.main import app, get_enricher
from tests.test_catalog_api import FakeProvider, add_body, candidate, posters_dir, use_enricher  # noqa: F401
from tests.test_enrich_providers import item, make_fetcher


def media(**over):
    data = {
        "id": 16498,
        "title": {"romaji": "Shingeki no Kyojin", "english": "Attack on Titan"},
        "startDate": {"year": 2013},
        "coverImage": {"extraLarge": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg", "large": "https://s4.anilist.co/medium.jpg"},
        "genres": ["Action", "Drama", "Mystery"],
        "averageScore": 85,
        "episodes": 25,
        "chapters": None,
        "countryOfOrigin": "JP",
    }
    data.update(over)
    return data


def page(*items):
    return {"data": {"Page": {"media": list(items)}}}


def anilist(responses, **kwargs):
    """Провайдер с заготовленными ответами: responses — функция (тело запроса) -> JSON или список ответов по очереди."""
    requests = []
    queue = list(responses) if isinstance(responses, list) else None

    def handler(request):
        body = json.loads(request.content)
        requests.append((request, body))
        data = queue.pop(0) if queue is not None else responses(body)
        return httpx.Response(200, json=data)

    return AniListProvider(fetcher=make_fetcher(handler), **kwargs), requests


# --- поиск ---

def test_search_sends_graphql_post_and_parses_results():
    provider, requests = anilist([page(media())])
    [result] = provider.search(item())

    request, body = requests[0]
    assert request.method == "POST" and str(request.url) == API_URL
    assert body["variables"] == {"search": "Shingeki no Kyojin", "type": "ANIME", "perPage": 10}
    assert "SEARCH_MATCH" in body["query"]

    assert result.source == "anilist"
    assert result.external_id == "anime:16498"
    assert result.title == "Attack on Titan"  # русского названия нет: английское
    assert result.original_title == "Shingeki no Kyojin"
    assert result.year == 2013
    assert result.poster_url == "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498.jpg"
    assert result.genres == ["экшен", "драма", "детектив"]
    assert result.country == "Япония"
    assert result.rating == 8.5
    assert result.total_episodes == 25 and result.total_chapters is None


def test_search_manga_uses_manga_type_and_chapter_total():
    provider, requests = anilist([page(media(id=30002, episodes=None, chapters=364, countryOfOrigin="KR"))])
    [result] = provider.search(item(category="manga", title_original="Berserk"))
    assert requests[0][1]["variables"]["type"] == "MANGA"
    assert result.external_id == "manga:30002"
    assert result.total_chapters == 364 and result.total_episodes is None
    assert result.country == "Южная Корея"


def test_search_falls_back_to_russian_title_when_nothing_found():
    provider, requests = anilist([page(), page(media())])
    assert len(provider.search(item())) == 1
    assert [b["variables"]["search"] for _, b in requests] == ["Shingeki no Kyojin", "Атака титанов"]


def test_search_nothing_found_returns_empty_list():
    provider, _ = anilist([page(), page()])
    assert provider.search(item()) == []


def test_title_falls_back_to_romaji_and_missing_fields_are_none():
    provider, _ = anilist([page(media(title={"romaji": "Tokyo Ghoul", "english": None}, startDate=None, coverImage=None, genres=None, averageScore=None, countryOfOrigin=None, episodes=0))])
    [result] = provider.search(item())
    assert result.title == "Tokyo Ghoul" and result.original_title == "Tokyo Ghoul"
    assert result.year is None and result.poster_url is None and result.genres == []
    assert result.rating is None and result.country is None
    assert result.total_episodes is None  # 0 — число неизвестно


def test_cover_falls_back_to_large():
    provider, _ = anilist([page(media(coverImage={"extraLarge": None, "large": "https://s4.anilist.co/m.jpg"}))])
    assert provider.search(item())[0].poster_url == "https://s4.anilist.co/m.jpg"


def test_graphql_errors_become_provider_error():
    provider, _ = anilist([{"errors": [{"message": "Too Many Requests."}], "data": None}])
    with pytest.raises(AniListError, match="Too Many Requests"):
        provider.search(item())


def test_http_error_propagates_after_retries():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(500)

    provider = AniListProvider(fetcher=make_fetcher(handler, max_retries=2))
    with pytest.raises(httpx.HTTPStatusError):
        provider.search(item())
    assert len(attempts) == 3  # первая попытка и два повтора


# --- популярное и детали ---

def test_popular_sorts_by_popularity_and_caps_page_size():
    provider, requests = anilist(lambda body: page(media()))
    results = provider.popular("anime", 100)
    body = requests[0][1]
    assert "POPULARITY_DESC" in body["query"]
    assert body["variables"] == {"type": "ANIME", "perPage": 50}
    assert results[0].external_id == "anime:16498" and results[0].rating == 8.5


def test_popular_manga():
    provider, requests = anilist(lambda body: page(media(id=2, episodes=None, chapters=10)))
    assert provider.popular("manga", 5)[0].external_id == "manga:2"
    assert requests[0][1]["variables"] == {"type": "MANGA", "perPage": 5}


def test_fill_details_adds_episode_total_and_genres_when_missing():
    provider, requests = anilist([{"data": {"Media": {"genres": ["Action", "Sci-Fi"], "episodes": 12, "chapters": None}}}])
    detailed = provider.fill_details(Candidate(source="anilist", external_id="anime:1", title="А"))
    assert requests[0][1]["variables"] == {"id": 1, "type": "ANIME"}
    assert detailed.total_episodes == 12 and detailed.total_chapters is None
    assert detailed.genres == ["экшен", "фантастика"]


def test_fill_details_keeps_given_genres_and_handles_manga():
    provider, requests = anilist([{"data": {"Media": {"genres": ["Action"], "episodes": None, "chapters": 150}}}])
    given = Candidate(source="anilist", external_id="manga:5", title="М", genres=["своё"])
    detailed = provider.fill_details(given)
    assert requests[0][1]["variables"]["type"] == "MANGA"
    assert detailed.total_chapters == 150 and detailed.total_episodes is None
    assert detailed.genres == ["своё"]


def test_fill_details_zero_or_missing_total_is_unknown():
    provider, _ = anilist([{"data": {"Media": {"genres": [], "episodes": 0}}}, {"data": {"Media": None}}])
    assert provider.fill_details(Candidate(source="anilist", external_id="anime:1", title="А")).total_episodes is None
    assert provider.fill_details(Candidate(source="anilist", external_id="anime:2", title="А")).total_episodes is None


# --- жанры ---

def test_translate_genres_known_and_unknown():
    assert translate_genres(["Slice of Life", "Mahou Shoujo", "Brand New Genre", ""]) == ["повседневность", "махо-сёдзё", "brand new genre"]
    assert all(v == v.lower() for v in GENRES.values())


# --- HttpFetcher.post ---

def test_fetcher_post_sends_json_and_retries_on_server_error():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(503 if len(seen) == 1 else 200, json={"ok": True})

    fetcher = make_fetcher(handler)
    assert fetcher.post("https://x.example/api", json={"a": 1}).json() == {"ok": True}
    assert seen == [{"a": 1}, {"a": 1}]


# --- реестр ---

def test_registry_lists_sources_and_categories():
    assert sources_for("anime") == sources_for("manga") == ["shikimori", "anilist"]
    assert sources_for("movie") == ["tmdb"]
    assert sources_for("podcast") == []
    assert categories_of("anilist") == {"anime", "manga"}
    assert categories_of("nope") == frozenset()
    assert PROVIDER_CLASSES.index(next(c for c in PROVIDER_CLASSES if c.source == "shikimori")) < PROVIDER_CLASSES.index(AniListProvider)


class StubShiki:
    source = "shikimori"
    categories = frozenset({"anime", "manga"})
    image_hosts = ()

    def __init__(self):
        self.fetcher = type("F", (), {"close": lambda self: None})()


class StubAni(StubShiki):
    source = "anilist"


class StubBroken(StubShiki):
    source = "broken"

    def __init__(self):
        raise ProviderConfigError("не настроен")


def test_enricher_default_is_first_and_source_selects_other():
    enricher = Enricher(provider_classes=(StubShiki, StubAni))
    assert enricher.provider_for("anime").source == "shikimori"
    assert enricher.provider_for("anime", "anilist").source == "anilist"
    assert enricher.provider_for("anime", "shikimori") is enricher.provider_for("anime")
    assert enricher.categories_of("anilist") == {"anime", "manga"}


def test_enricher_wrong_source_for_category():
    enricher = Enricher(provider_classes=(StubShiki, StubAni))
    with pytest.raises(UnsupportedCategoryError, match="не обслуживает"):
        enricher.provider_for("anime", "tmdb")
    with pytest.raises(UnsupportedCategoryError, match="не поддерживается"):
        enricher.provider_for("movie", "tmdb")


def test_enricher_unconfigured_chosen_source_reports_config_error():
    enricher = Enricher(provider_classes=(StubShiki, StubBroken))
    with pytest.raises(ProviderConfigError):
        enricher.provider_for("anime", "broken")
    assert enricher.provider_for("anime").source == "shikimori"  # по умолчанию это не мешает


# --- API: параметр source ---

class SourceProvider(FakeProvider):
    categories = frozenset({"anime", "manga"})

    def __init__(self, source, candidates=None):
        super().__init__(candidates)
        self.source = source
        self.popular_calls = []

    def popular(self, category, limit):
        self.popular_calls.append((category, limit))
        return self.candidates


class TwoSourcesEnricher:
    """Реестр с двумя источниками для аниме и манги: по умолчанию первый."""

    def __init__(self):
        self.shiki = SourceProvider("shikimori", [candidate("s1", source="shikimori")])
        self.ani = SourceProvider("anilist", [candidate("a1", source="anilist", rating=8.1)])
        self.asked = []
        self.downloads = []

    def provider_for(self, category, source=None):
        self.asked.append((category, source))
        if category not in ("anime", "manga"):
            raise UnsupportedCategoryError(f"Для категории «{category}» нет источника")
        if source in (None, "shikimori"):
            return self.shiki
        if source == "anilist":
            return self.ani
        raise UnsupportedCategoryError(f"Источник «{source}» не обслуживает категорию «{category}»")

    def categories_of(self, source):
        return frozenset({"anime", "manga"}) if source in ("shikimori", "anilist") else frozenset()

    def download(self, url):
        self.downloads.append(url)
        return b"\x89PNG\r\n\x1a\npng", "image/png"


@pytest.fixture
def two_sources(client):
    enricher = TwoSourcesEnricher()
    app.dependency_overrides[get_enricher] = lambda: enricher
    return enricher


def test_search_default_source_and_explicit_source(client, two_sources):
    default = client.get("/catalog/search", params={"q": "Фрирен", "category": "anime"}).json()
    assert [r["external_id"] for r in default["results"]] == ["s1"]
    other = client.get("/catalog/search", params={"q": "Фрирен", "category": "anime", "source": "anilist"}).json()
    assert [(r["source"], r["external_id"]) for r in other["results"]] == [("anilist", "a1")]


def test_search_source_without_category_limits_to_its_categories(client, two_sources):
    body = client.get("/catalog/search", params={"q": "Фрирен", "source": "anilist"}).json()
    assert {r["category"] for r in body["results"]} == {"anime", "manga"}
    assert {c for c, s in two_sources.asked} == {"anime", "manga"}  # кино и книги этот источник не опрашивались


def test_unknown_source_without_category_is_400(client, two_sources):
    assert client.get("/catalog/search", params={"q": "Фрирен", "source": "nope"}).status_code == 400
    assert client.get("/catalog/popular", params={"source": "nope"}).status_code == 400


def test_wrong_source_for_explicit_category_is_400(client, two_sources):
    response = client.get("/catalog/search", params={"q": "Фрирен", "category": "anime", "source": "tmdb"})
    assert response.status_code == 400
    assert "не обслуживает" in response.json()["detail"]


def test_popular_cache_is_per_source(client, two_sources):
    for source in (None, "anilist", "anilist", None):
        params = {"category": "anime"}
        if source:
            params["source"] = source
        assert client.get("/catalog/popular", params=params).status_code == 200
    assert len(two_sources.shiki.popular_calls) == 1 and len(two_sources.ani.popular_calls) == 1
    body = client.get("/catalog/popular", params={"category": "anime", "source": "anilist"}).json()
    assert body["results"][0]["rating"] == 8.1 and body["results"][0]["source"] == "anilist"


def test_enrich_candidates_with_source(client, two_sources):
    item = client.post("/items/", json={"title_ru": "Фрирен", "category": "anime"}).json()
    default = client.get(f"/items/{item['id']}/enrich/candidates").json()
    other = client.get(f"/items/{item['id']}/enrich/candidates", params={"source": "anilist"}).json()
    assert default[0]["external_id"] == "s1" and other[0]["external_id"] == "a1"


def test_enrich_apply_with_other_source(client, two_sources, posters_dir):
    item = client.post("/items/", json={"title_ru": "Фрирен", "category": "anime"}).json()
    response = client.post(f"/items/{item['id']}/enrich/apply", json={"source": "anilist", "external_id": "a1"})
    assert response.status_code == 200, response.text
    assert "genres" in response.json()["changed"]
    assert ("anime", "anilist") in two_sources.asked


def test_add_from_catalog_from_other_source(client, two_sources, posters_dir):
    response = client.post("/items/from-catalog", json=add_body(source="anilist", external_id="a1"))
    assert response.status_code == 201, response.text
    assert ("anime", "anilist") in two_sources.asked
