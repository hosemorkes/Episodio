"""Тесты «популярного» и итогов серий/глав: провайдеры на заглушках, сеть не используется."""
import httpx
import pytest

from backend import catalog
from backend.enrich.base import Candidate, ProviderAuthError, ProviderConfigError
from backend.enrich.openlibrary import OpenLibraryProvider
from backend.enrich.shikimori import ShikimoriProvider
from backend.enrich.tmdb import TMDBProvider
from tests.test_catalog_api import FakeEnricher, FakeProvider, add_body, candidate, posters_dir, use_enricher  # noqa: F401
from tests.test_enrich_providers import load_fixture, make_fetcher

KEY = "0123456789abcdef0123456789abcdef"


# --- TMDB ---

def tmdb(responses):
    """Провайдер TMDB; responses: {путь: ответ}. Возвращает (провайдер, список запросов)."""
    requests = []

    def handler(request):
        requests.append(request)
        path = request.url.path.removeprefix("/3")
        if path in responses:
            return httpx.Response(200, json=responses[path])
        if path == "/genre/tv/list":
            return httpx.Response(200, json=load_fixture("tmdb_genres_tv.json"))
        if path == "/genre/movie/list":
            return httpx.Response(200, json=load_fixture("tmdb_genres_movie.json"))
        return httpx.Response(404)

    return TMDBProvider(api_key=KEY, fetcher=make_fetcher(handler)), requests


def last(requests, path):
    return next(r for r in reversed(requests) if r.url.path.endswith(path))


def test_tmdb_popular_movies_uses_movie_popular():
    provider, requests = tmdb({"/movie/popular": load_fixture("tmdb_search_movie.json")})
    results = provider.popular("movie", 5)
    assert results and all(c.source == "tmdb" for c in results)
    request = last(requests, "/movie/popular")
    assert request.url.params["language"] == "ru-RU"


def test_tmdb_popular_limit_cuts_results():
    provider, _ = tmdb({"/movie/popular": load_fixture("tmdb_search_movie.json")})
    assert len(provider.popular("movie", 1)) == 1


def test_tmdb_popular_series_excludes_animation_and_shows():
    provider, requests = tmdb({"/discover/tv": load_fixture("tmdb_search_tv.json")})
    provider.popular("tv_series", 10)
    params = last(requests, "/discover/tv").url.params
    assert params["sort_by"] == "popularity.desc"
    assert params["without_genres"] == "16,10763,10764,10767"
    assert "with_genres" not in params


def test_tmdb_popular_cartoon_and_show_use_genre_filters():
    provider, requests = tmdb({"/discover/tv": load_fixture("tmdb_search_tv.json")})
    provider.popular("cartoon", 10)
    assert last(requests, "/discover/tv").url.params["with_genres"] == "16"
    provider.popular("tv_show", 10)
    assert last(requests, "/discover/tv").url.params["with_genres"] == "10763|10764|10767"


def test_tmdb_popular_carries_rating_and_genres():
    provider, _ = tmdb({"/discover/tv": load_fixture("tmdb_search_tv.json")})
    first = provider.popular("tv_series", 10)[0]
    assert first.rating == 8.0
    assert first.genres  # жанры по справочнику, а не коды


def test_tmdb_popular_empty_result_skips_genre_request():
    provider, requests = tmdb({"/movie/popular": {"results": []}})
    assert provider.popular("movie", 5) == []
    assert not any("genre" in r.url.path for r in requests)


def test_tmdb_rating_zero_is_none():
    provider, _ = tmdb({"/movie/popular": {"results": [{"id": 1, "title": "Анонс", "vote_average": 0, "genre_ids": []}]}})
    assert provider.popular("movie", 5)[0].rating is None


def tv_details(**data):
    return {"/tv/1215": {"number_of_episodes": 84, "status": "Ended", **data}}


def test_tmdb_fill_details_sets_total_for_finished_series():
    provider, requests = tmdb(tv_details())
    detailed = provider.fill_details(Candidate(source="tmdb", external_id="1215", title="Т", category="tv_series"))
    assert detailed.total_episodes == 84
    assert requests[-1].url.path == "/3/tv/1215"


def test_tmdb_fill_details_ignores_running_series():
    provider, _ = tmdb(tv_details(status="Returning Series"))
    detailed = provider.fill_details(Candidate(source="tmdb", external_id="1215", title="Т", category="tv_series"))
    assert detailed.total_episodes is None  # у идущего сериала число вышедших серий — не итог


def test_tmdb_fill_details_canceled_counts_and_zero_does_not():
    provider, _ = tmdb(tv_details(status="Canceled"))
    assert provider.fill_details(Candidate(source="tmdb", external_id="1215", title="Т", category="cartoon")).total_episodes == 84
    provider, _ = tmdb(tv_details(number_of_episodes=0))
    assert provider.fill_details(Candidate(source="tmdb", external_id="1215", title="Т", category="tv_show")).total_episodes is None


def test_tmdb_fill_details_does_nothing_for_movies_and_unknown_category():
    provider, requests = tmdb({})
    for category in ("movie", None):
        c = Candidate(source="tmdb", external_id="5", title="Ф", category=category)
        assert provider.fill_details(c) == c
    assert requests == []


# --- Shikimori ---

def shikimori(handler):
    requests = []

    def recording(request):
        requests.append(request)
        return handler(request)

    return ShikimoriProvider(user_agent="Episodio-tests", fetcher=make_fetcher(recording, user_agent="Episodio-tests")), requests


def test_shikimori_popular_orders_by_popularity_and_caps_limit():
    provider, requests = shikimori(lambda r: httpx.Response(200, json=load_fixture("shikimori_animes.json")))
    results = provider.popular("anime", 100)
    assert requests[0].url.path == "/api/animes"
    assert requests[0].url.params["order"] == "popularity"
    assert requests[0].url.params["limit"] == "50"  # максимум API
    assert results[0].external_id == "anime:16498"
    assert results[0].rating == 8.58


def test_shikimori_popular_manga_uses_mangas_resource():
    provider, requests = shikimori(lambda r: httpx.Response(200, json=load_fixture("shikimori_mangas.json")))
    results = provider.popular("manga", 5)
    assert requests[0].url.path == "/api/mangas"
    assert all(c.external_id.startswith("manga:") for c in results)


@pytest.mark.parametrize("score,expected", [("0.0", None), (None, None), ("abc", None), ("7.5", 7.5)])
def test_shikimori_score_to_rating(score, expected):
    provider, _ = shikimori(lambda r: httpx.Response(200, json=[{"id": 1, "name": "X", "russian": "Х", "score": score}]))
    assert provider.popular("anime", 5)[0].rating == expected


def shiki_details(data):
    return lambda r: httpx.Response(200, json=data)


def test_shikimori_fill_details_sets_episode_total_for_anime():
    provider, _ = shikimori(shiki_details({"genres": [{"russian": "Экшен"}], "episodes": 25, "episodes_aired": 25}))
    detailed = provider.fill_details(Candidate(source="shikimori", external_id="anime:16498", title="А"))
    assert detailed.total_episodes == 25 and detailed.total_chapters is None
    assert detailed.genres == ["экшен"]


def test_shikimori_fill_details_sets_chapter_total_for_manga():
    provider, _ = shikimori(shiki_details({"genres": [], "chapters": 364, "volumes": 41}))
    detailed = provider.fill_details(Candidate(source="shikimori", external_id="manga:2", title="М"))
    assert detailed.total_chapters == 364 and detailed.total_episodes is None


def test_shikimori_fill_details_zero_total_means_unknown():
    provider, _ = shikimori(shiki_details({"genres": [], "episodes": 0, "episodes_aired": 7}))
    assert provider.fill_details(Candidate(source="shikimori", external_id="anime:1", title="А")).total_episodes is None
    provider, _ = shikimori(shiki_details({"genres": []}))
    assert provider.fill_details(Candidate(source="shikimori", external_id="manga:1", title="М")).total_chapters is None


# --- Open Library ---

def openlibrary():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=load_fixture("openlibrary_trending.json"))

    return OpenLibraryProvider(fetcher=make_fetcher(handler)), requests


def test_openlibrary_popular_uses_trending_and_skips_broken_works():
    provider, requests = openlibrary()
    results = provider.popular("book", 10)
    assert requests[0].url.path == "/trending/weekly.json"
    assert requests[0].url.params["limit"] == "10"
    assert [c.title for c in results] == ["Atomic Habits", "Без обложки"]
    assert results[0].author == "James Clear"
    assert results[0].poster_url == "https://covers.openlibrary.org/b/id/12539702-L.jpg?default=false"
    assert results[1].poster_url is None and results[1].author is None


def test_openlibrary_popular_limit():
    provider, _ = openlibrary()
    assert len(provider.popular("audiobook", 1)) == 1


# --- GET /catalog/popular ---

class PopularProvider(FakeProvider):
    def __init__(self, candidates=None, error=None):
        super().__init__(candidates, error)
        self.popular_calls = []

    def popular(self, category, limit):
        self.popular_calls.append((category, limit))
        if self.error:
            raise self.error
        return self.candidates


def test_popular_one_category(client, use_enricher):
    provider = PopularProvider([candidate("1", rating=8.5), candidate("2", title="Другое")])
    use_enricher(default=provider)
    response = client.get("/catalog/popular", params={"category": "anime", "limit": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert [r["external_id"] for r in body["results"]] == ["1", "2"]
    assert body["results"][0]["rating"] == 8.5
    assert body["results"][0]["category"] == "anime"
    assert provider.popular_calls == [("anime", 5)]


def test_popular_without_category_covers_main_categories(client, use_enricher):
    enricher = use_enricher(default=PopularProvider([candidate("1")]))
    body = client.get("/catalog/popular").json()
    assert enricher.asked == list(catalog.DEFAULT_CATEGORIES)
    assert {r["category"] for r in body["results"]} == set(catalog.DEFAULT_CATEGORIES)


def test_popular_default_and_max_limit(client, use_enricher):
    provider = PopularProvider()
    use_enricher(default=provider)
    client.get("/catalog/popular", params={"category": "movie"})
    assert provider.popular_calls == [("movie", 12)]
    assert client.get("/catalog/popular", params={"limit": 31}).status_code == 422
    assert client.get("/catalog/popular", params={"limit": 0}).status_code == 422
    assert client.get("/catalog/popular", params={"category": "podcast"}).status_code == 422


def test_popular_is_cached_for_an_hour(client, use_enricher):
    provider = PopularProvider()
    use_enricher(default=provider)
    for _ in range(3):
        assert client.get("/catalog/popular", params={"category": "anime"}).status_code == 200
    assert len(provider.popular_calls) == 1
    # другая категория или другой лимит — отдельный ответ
    client.get("/catalog/popular", params={"category": "movie"})
    client.get("/catalog/popular", params={"category": "anime", "limit": 3})
    assert len(provider.popular_calls) == 3


def test_popular_cache_expires():
    provider = PopularProvider()
    enricher = FakeEnricher(default=provider)
    now = [1000.0]

    def run():
        return catalog.popular_catalog(enricher, ("anime",), 12, (httpx.HTTPError,), str, clock=lambda: now[0])

    run()
    now[0] += catalog.POPULAR_TTL - 1
    run()
    assert len(provider.popular_calls) == 1
    now[0] += 2
    run()
    assert len(provider.popular_calls) == 2


def test_popular_errors_are_not_cached(client, use_enricher):
    provider = PopularProvider(error=httpx.ConnectError("down"))
    use_enricher(default=provider)
    assert client.get("/catalog/popular", params={"category": "anime"}).status_code == 502
    provider.error = None
    assert client.get("/catalog/popular", params={"category": "anime"}).status_code == 200
    assert len(provider.popular_calls) == 2


def test_popular_partial_failure_keeps_other_results(client, use_enricher):
    use_enricher(
        providers={"movie": ProviderConfigError("нет ключа")},
        default=PopularProvider([candidate("1")]),
    )
    body = client.get("/catalog/popular").json()
    assert {r["category"] for r in body["results"]} == {"anime", "tv_series", "manga", "book"}
    assert len(body["errors"]) == 1 and "нет ключа" in body["errors"][0]


def test_popular_single_category_failure_maps_to_503_or_502(client, use_enricher):
    use_enricher(default=PopularProvider(error=ProviderConfigError("нет ключа")))
    assert client.get("/catalog/popular", params={"category": "movie"}).status_code == 503
    use_enricher(default=PopularProvider(error=ProviderAuthError("ключ не принят")))
    assert client.get("/catalog/popular", params={"category": "movie"}).status_code == 503
    use_enricher(default=PopularProvider(error=httpx.ReadTimeout("slow")))
    assert client.get("/catalog/popular", params={"category": "movie"}).status_code == 502


def test_popular_provider_without_support_reports_error(client, use_enricher):
    use_enricher(default=FakeProvider())  # метода popular нет
    response = client.get("/catalog/popular", params={"category": "anime"})
    assert response.status_code == 502
    assert "популярное недоступно" in response.json()["detail"]


def test_popular_requires_api_key_when_set(client, use_enricher, monkeypatch):
    use_enricher(default=PopularProvider())
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/catalog/popular").status_code == 401


# --- POST /items/from-catalog: итоги серий и глав ---

class DetailedProvider(FakeProvider):
    def __init__(self, **details):
        super().__init__()
        self.details = details
        self.seen = []

    def fill_details(self, c):
        self.seen.append(c)
        return Candidate(**{**c.__dict__, **self.details})


def test_add_from_catalog_saves_episode_total(client, use_enricher, posters_dir):
    provider = DetailedProvider(total_episodes=28)
    use_enricher(default=provider)
    item = client.post("/items/from-catalog", json=add_body()).json()
    assert item["total_episodes"] == 28
    assert item["total_chapters"] is None
    assert provider.seen[0].category == "anime"  # провайдер узнаёт категорию (у TMDB id не определяет тип)


def test_add_from_catalog_saves_chapter_total(client, use_enricher, posters_dir):
    use_enricher(default=DetailedProvider(total_chapters=364))
    item = client.post("/items/from-catalog", json=add_body(category="manga")).json()
    assert item["total_chapters"] == 364
    assert item["total_episodes"] is None


def test_add_from_catalog_keeps_given_genres_but_still_takes_totals(client, use_enricher, posters_dir):
    use_enricher(default=DetailedProvider(genres=["чужой жанр"], total_episodes=12))
    item = client.post("/items/from-catalog", json=add_body()).json()
    assert item["genres"] == ["фэнтези", "драма"]
    assert item["total_episodes"] == 12


def test_add_from_catalog_provider_without_details_has_no_totals(client, use_enricher, posters_dir):
    use_enricher()
    item = client.post("/items/from-catalog", json=add_body()).json()
    assert item["total_episodes"] is None and item["total_chapters"] is None


def test_add_from_catalog_details_error_still_creates_item_without_totals(client, use_enricher, posters_dir):
    class Broken(DetailedProvider):
        def fill_details(self, c):
            raise httpx.ReadTimeout("slow")

    use_enricher(default=Broken())
    response = client.post("/items/from-catalog", json=add_body())
    assert response.status_code == 201
    assert response.json()["total_episodes"] is None


def test_tmdb_candidate_gets_description_from_overview():
    provider, _ = tmdb({"/movie/popular": load_fixture("tmdb_search_tv.json")})
    descriptions = [c.description for c in provider.popular("movie", 5)]
    assert "Хэнк Муди — писатель, потерявший вдохновение." in descriptions
    assert None in descriptions  # пустой overview не превращается в пустую строку
