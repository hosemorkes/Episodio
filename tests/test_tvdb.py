"""Тесты провайдера TheTVDB и запасного выбора источника. Сеть не используется (httpx.MockTransport)."""
import json

import httpx
import pytest

from backend.enrich.base import ProviderAuthError, ProviderConfigError, find_matches
from backend.enrich.registry import Enricher
from backend.enrich.tmdb import TMDBProvider
from backend.enrich.tvdb import API_BASE, TVDBAuthError, TVDBConfigError, TVDBError, TVDBProvider, translate_genres
from tests.test_enrich_providers import item, make_fetcher

SEARCH_RESULT = {
    "tvdb_id": "121361",
    "name": "Game of Thrones",
    "translations": {"rus": "Игра престолов", "eng": "Game of Thrones"},
    "year": "2011",
    "image_url": "https://artworks.thetvdb.com/banners/posters/121361-4.jpg",
    "country": "usa",
    "genres": ["Drama", "Fantasy", "Adventure", "Weird Genre"],
    "type": "series",
}


def tvdb(search_data=None, login_status=200, search_statuses=None, **kwargs):
    """Провайдер с заготовленными ответами. Возвращает (провайдер, список запросов)."""
    requests = []
    statuses = list(search_statuses or [])
    tokens = iter(["token-1", "token-2", "token-3"])

    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/login"):
            if login_status != 200:
                return httpx.Response(login_status, json={"status": "failure"})
            return httpx.Response(200, json={"status": "success", "data": {"token": next(tokens)}})
        if statuses and (status := statuses.pop(0)) != 200:
            return httpx.Response(status, json={})
        return httpx.Response(200, json={"status": "success", "data": search_data if search_data is not None else [SEARCH_RESULT]})

    provider = TVDBProvider(api_key="key", fetcher=make_fetcher(handler), **kwargs)
    return provider, requests


def test_search_logs_in_once_and_parses_results():
    provider, requests = tvdb()
    series = item(category="tv_series", title_original="Game of Thrones", title_ru="Игра престолов", release_year=2011)

    [candidate] = provider.search(series)
    provider.search(series)

    logins = [r for r in requests if r.url.path.endswith("/login")]
    assert len(logins) == 1 and json.loads(logins[0].content) == {"apikey": "key"}
    search = [r for r in requests if r.url.path.endswith("/search")][0]
    assert search.headers["Authorization"] == "Bearer token-1"
    assert dict(search.url.params) == {"query": "Game of Thrones", "type": "series", "limit": "10", "year": "2011"}

    assert candidate.source == "tvdb" and candidate.external_id == "121361"
    assert candidate.title == "Игра престолов" and candidate.original_title == "Game of Thrones"
    assert candidate.year == 2011 and candidate.country == "США"
    assert candidate.poster_url.startswith("https://artworks.thetvdb.com/")
    assert candidate.genres == ["драма", "фэнтези", "приключения", "weird genre"]
    assert find_matches(series, [candidate]) == [candidate]


def test_search_movie_uses_movie_type_and_pin_is_sent():
    provider, requests = tvdb(pin="1234")
    provider.search(item(category="movie", release_year=None))
    assert json.loads(requests[0].content) == {"apikey": "key", "pin": "1234"}
    assert requests[1].url.params["type"] == "movie" and "year" not in requests[1].url.params


def test_search_retries_without_year_then_with_russian_title():
    answers = iter([[], [], [SEARCH_RESULT]])

    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"data": {"token": "t"}})
        return httpx.Response(200, json={"data": next(answers)})

    provider = TVDBProvider(api_key="key", fetcher=make_fetcher(handler))
    result = provider.search(item(category="tv_series", title_original="Nope", title_ru="Игра престолов", release_year=2011))
    assert [c.external_id for c in result] == ["121361"]


def test_nothing_found_returns_empty_list():
    provider, _ = tvdb(search_data=[])
    assert provider.search(item(category="tv_series")) == []


def test_missing_fields_are_empty():
    provider, _ = tvdb(search_data=[{"tvdb_id": "5", "name": "X"}])
    [candidate] = provider.search(item(category="tv_series"))
    assert candidate.title == "X" and candidate.year is None and candidate.country is None
    assert candidate.poster_url is None and candidate.genres == []


def test_expired_token_is_refreshed_once():
    provider, requests = tvdb(search_statuses=[200, 401, 200])
    series = item(category="tv_series", title_original="A", release_year=None)
    provider.search(series)
    provider.search(series)  # сервер ответил 401 -> новый токен и повтор

    logins = [r for r in requests if r.url.path.endswith("/login")]
    assert len(logins) == 2
    assert requests[-1].headers["Authorization"] == "Bearer token-2"


def test_persistent_401_is_auth_error():
    provider, _ = tvdb(search_statuses=[401, 401])
    with pytest.raises(ProviderAuthError):
        provider.search(item(category="tv_series"))


def test_invalid_key_on_login_is_auth_error():
    provider, _ = tvdb(login_status=401)
    with pytest.raises(TVDBAuthError, match="TVDB_API_KEY"):
        provider.search(item(category="tv_series"))


def test_login_without_token_is_error():
    def handler(request):
        return httpx.Response(200, json={"data": {}})

    provider = TVDBProvider(api_key="key", fetcher=make_fetcher(handler))
    with pytest.raises(TVDBError, match="токен"):
        provider.search(item(category="tv_series"))


def test_http_error_propagates_after_retries():
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"data": {"token": "t"}})
        return httpx.Response(503)

    provider = TVDBProvider(api_key="key", fetcher=make_fetcher(handler, max_retries=1))
    with pytest.raises(httpx.HTTPStatusError):
        provider.search(item(category="tv_series"))


def test_missing_key_is_config_error(monkeypatch):
    monkeypatch.delenv("TVDB_API_KEY", raising=False)
    with pytest.raises(TVDBConfigError, match="TVDB_API_KEY"):
        TVDBProvider()
    monkeypatch.setenv("TVDB_API_KEY", "abc")
    monkeypatch.setenv("TVDB_PIN", "99")
    provider = TVDBProvider()
    assert provider._api_key == "abc" and provider._pin == "99"
    provider.fetcher.close()


def test_translate_genres_known_and_unknown():
    assert translate_genres(["Science Fiction", "Animation", "Odd", ""]) == ["фантастика", "мультфильм", "odd"]


def test_api_base_is_v4():
    assert API_BASE == "https://api4.thetvdb.com/v4"


# --- запасной источник ---

def test_enricher_falls_back_to_tvdb_when_tmdb_is_not_configured(monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.setenv("TVDB_API_KEY", "abc")
    enricher = Enricher()
    try:
        assert enricher.provider_for("tv_series").source == "tvdb"
        assert enricher.provider_for("movie", "tvdb").source == "tvdb"
        with pytest.raises(ProviderConfigError, match="TMDB_API_KEY"):
            enricher.provider_for("movie", "tmdb")  # явно выбранный источник не подменяется
    finally:
        enricher.close()


def test_enricher_prefers_tmdb_when_both_configured(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "abc")
    monkeypatch.setenv("TVDB_API_KEY", "abc")
    enricher = Enricher()
    try:
        assert isinstance(enricher.provider_for("tv_series"), TMDBProvider)
    finally:
        enricher.close()


def test_enricher_reports_first_config_error_when_nothing_is_configured(monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.delenv("TVDB_API_KEY", raising=False)
    with pytest.raises(ProviderConfigError, match="TMDB_API_KEY"):
        Enricher().provider_for("tv_series")
