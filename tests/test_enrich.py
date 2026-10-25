"""Тесты обогащения карточек. Реальная сеть не используется: httpx.MockTransport и заготовленные ответы TMDB."""
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from backend import posters
from backend.enrich.base import Candidate, apply_candidate, find_matches, normalize_title, pick_match
from backend.enrich.client import HttpFetcher, download_image
from backend.enrich.tmdb import TMDBAuthError, TMDBError, TMDBProvider
from backend.models import MediaItem
from scripts import enrich
from scripts.enrich import merge_review, needs_enrichment, run_enrich, select_items

FIXTURES = Path(__file__).parent / "fixtures"
PNG = b"\x89PNG\r\n\x1a\n" + b"png-data"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def item(**overrides):
    """Карточка без БД."""
    data = {
        "id": 1, "title_ru": "Блудливая Калифорния", "title_original": "Californication",
        "category": "tv_series", "release_year": 2007, "poster_url": None, "genres": [],
        "country": None, "author": None,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def candidate(**overrides):
    data = {
        "source": "tmdb", "external_id": "1", "title": "Блудливая Калифорния",
        "original_title": "Californication", "year": 2007, "poster_url": "https://image.tmdb.org/t/p/w500/a.jpg",
        "genres": ["драма", "комедия"], "country": "США", "author": None,
    }
    data.update(overrides)
    return Candidate(**data)


# --- normalize_title / pick_match ---

def test_normalize_title():
    assert normalize_title("  Spider-Man:  Homecoming! ") == "spider man homecoming"
    assert normalize_title("Howl's Moving Castle") == "howls moving castle"
    assert normalize_title("Ёжик") == "ежик"
    assert normalize_title(None) == ""


def test_pick_match_exact():
    c = candidate()
    assert pick_match(item(), [c]) is c


def test_pick_match_ignores_case_and_punctuation():
    c = candidate(original_title="CALIFORNICATION!")
    assert pick_match(item(), [c]) is c


def test_pick_match_ignores_spaces_in_romanized_titles():
    target = item(title_original="Quan zhi gao shou", title_ru="Аватар короля", release_year=2017)
    right = candidate(external_id="1", title="Аватар короля", original_title="Quanzhi Gaoshou", year=2017)
    sequel = candidate(external_id="2", title="Аватар короля 2", original_title="Quanzhi Gaoshou 2", year=2020)
    specials = candidate(external_id="3", title="Спецвыпуски", original_title="Quanzhi Gaoshou Specials", year=2018)

    assert pick_match(target, [specials, right, sequel]) is right


def test_pick_match_year_within_one():
    assert pick_match(item(release_year=2008), [candidate(year=2007)]) is not None
    assert pick_match(item(release_year=2006), [candidate(year=2007)]) is not None


def test_pick_match_year_off_by_two_rejected():
    assert pick_match(item(release_year=2009), [candidate(year=2007)]) is None


def test_pick_match_unknown_year_is_not_checked():
    assert pick_match(item(release_year=None), [candidate(year=1999)]) is not None
    assert pick_match(item(release_year=2007), [candidate(year=None)]) is not None


def test_pick_match_two_identical_candidates_is_ambiguous():
    first, second = candidate(external_id="1"), candidate(external_id="2")
    assert pick_match(item(), [first, second]) is None
    assert len(find_matches(item(), [first, second])) == 2


def test_pick_match_same_candidate_twice_counts_once():
    c = candidate()
    assert pick_match(item(), [c, candidate()]) is c


def test_pick_match_no_candidates_or_no_match():
    assert pick_match(item(), []) is None
    assert pick_match(item(), [candidate(title="Другое", original_title="Other")]) is None


def test_pick_match_compares_with_original_title_when_present():
    """Есть title_original: русское название записи не учитывается, кандидат с другим оригиналом не подходит."""
    other_original = candidate(title="Блудливая Калифорния", original_title="Something Else")
    assert pick_match(item(), [other_original]) is None
    # а без title_original сравнение идёт по русскому названию
    assert pick_match(item(title_original=None), [other_original]) is other_original


def test_pick_match_falls_back_to_russian_title():
    c = candidate()
    assert pick_match(item(title_original=None), [c]) is c
    assert pick_match(item(title_original=""), [c]) is c


# --- apply_candidate ---

def test_apply_candidate_fills_empty_fields():
    target = item(release_year=None)
    changed = apply_candidate(target, candidate(author="Автор"))

    assert changed == ["poster_url", "genres", "country", "release_year", "author"]
    assert target.poster_url == "https://image.tmdb.org/t/p/w500/a.jpg"
    assert target.genres == ["драма", "комедия"]
    assert target.country == "США"
    assert target.release_year == 2007
    assert target.author == "Автор"


def test_apply_candidate_never_overwrites_filled_fields():
    target = item(
        poster_url="/posters/1.png", genres=["мои жанры"], country="Моя страна",
        release_year=1999, author="Я сам",
    )
    changed = apply_candidate(target, candidate(author="Автор"))

    assert changed == []
    assert (target.poster_url, target.genres, target.country, target.release_year, target.author) == (
        "/posters/1.png", ["мои жанры"], "Моя страна", 1999, "Я сам",
    )


def test_apply_candidate_fills_only_missing_ones():
    target = item(country="Моя страна", genres=["мои жанры"], release_year=None)
    changed = apply_candidate(target, candidate())

    assert changed == ["poster_url", "release_year"]
    assert target.country == "Моя страна"
    assert target.genres == ["мои жанры"]


def test_apply_candidate_treats_blank_values_as_empty():
    target = item(country="  ", poster_url="", genres=[])
    assert set(apply_candidate(target, candidate())) >= {"country", "poster_url", "genres"}
    assert target.country == "США"


def test_apply_candidate_ignores_empty_candidate_values():
    target = item()
    changed = apply_candidate(target, candidate(poster_url=None, genres=[], country=None, year=None))
    assert changed == []


def test_apply_candidate_uses_local_poster_path():
    target = item()
    apply_candidate(target, candidate(), poster_url="/posters/1.jpg")
    assert target.poster_url == "/posters/1.jpg"


# --- HttpFetcher: пауза и повторы ---

class FakeTime:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def make_fetcher(handler, fake=None, **kwargs):
    fake = fake or FakeTime()
    kwargs.setdefault("min_interval", 0.0)
    fetcher = HttpFetcher(transport=httpx.MockTransport(handler), sleep=fake.sleep, clock=fake.clock, **kwargs)
    return fetcher, fake


def test_fetcher_pauses_between_requests():
    fetcher, fake = make_fetcher(lambda request: httpx.Response(200, json={}), min_interval=0.25)
    for _ in range(3):
        fetcher.get("https://example.com/")
    assert fake.sleeps == [0.25, 0.25]  # перед первым запросом пауза не нужна


def test_fetcher_retries_429_and_respects_retry_after():
    responses = [httpx.Response(429, headers={"Retry-After": "2"}), httpx.Response(200, json={"ok": True})]
    fetcher, fake = make_fetcher(lambda request: responses.pop(0))

    assert fetcher.get("https://example.com/").json() == {"ok": True}
    assert fake.sleeps == [2.0]


def test_fetcher_retries_5xx_with_backoff():
    responses = [httpx.Response(500), httpx.Response(502), httpx.Response(200, json={})]
    fetcher, fake = make_fetcher(lambda request: responses.pop(0))

    assert fetcher.get("https://example.com/").status_code == 200
    assert fake.sleeps == [1.0, 2.0]


def test_fetcher_gives_up_after_max_retries():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503)

    fetcher, _ = make_fetcher(handler, max_retries=2)
    with pytest.raises(httpx.HTTPStatusError):
        fetcher.get("https://example.com/")
    assert len(calls) == 3


def test_fetcher_does_not_retry_client_errors():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(404)

    fetcher, _ = make_fetcher(handler)
    with pytest.raises(httpx.HTTPStatusError):
        fetcher.get("https://example.com/")
    assert len(calls) == 1


def test_fetcher_retries_network_errors():
    attempts = []

    def handler(request):
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ConnectError("сеть недоступна")
        return httpx.Response(200, json={})

    fetcher, _ = make_fetcher(handler)
    assert fetcher.get("https://example.com/").status_code == 200
    assert len(attempts) == 2


def test_download_image_returns_content_and_type():
    fetcher, _ = make_fetcher(lambda request: httpx.Response(200, content=PNG, headers={"content-type": "image/png"}))
    assert download_image(fetcher, "https://image.tmdb.org/t/p/w500/a.png") == (PNG, "image/png")


# --- TMDBProvider ---

def tmdb_provider(api_key="0123456789abcdef0123456789abcdef", search_override=None):
    """Провайдер, ходящий в заготовленные ответы. Возвращает (провайдер, список запросов)."""
    requests = []

    def handler(request):
        requests.append(request)
        path = request.url.path
        if path == "/3/search/tv":
            return httpx.Response(200, json=(search_override or load_fixture("tmdb_search_tv.json")))
        if path == "/3/search/movie":
            return httpx.Response(200, json=(search_override or load_fixture("tmdb_search_movie.json")))
        if path == "/3/genre/tv/list":
            return httpx.Response(200, json=load_fixture("tmdb_genres_tv.json"))
        if path == "/3/genre/movie/list":
            return httpx.Response(200, json=load_fixture("tmdb_genres_movie.json"))
        return httpx.Response(404)

    fetcher, _ = make_fetcher(handler)
    return TMDBProvider(api_key=api_key, fetcher=fetcher), requests


def test_tmdb_requires_api_key(monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    with pytest.raises(TMDBError, match="TMDB_API_KEY"):
        TMDBProvider()


def test_tmdb_reads_key_from_environment(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "abc123")
    fetcher, _ = make_fetcher(lambda request: httpx.Response(200, json={"results": []}))
    TMDBProvider(fetcher=fetcher)


def test_tmdb_parses_tv_results():
    provider, _ = tmdb_provider()
    first, second = provider.search(item())

    assert first.source == "tmdb"
    assert first.external_id == "1215"
    assert first.title == "Блудливая Калифорния"
    assert first.original_title == "Californication"
    assert first.year == 2007
    assert first.poster_url == "https://image.tmdb.org/t/p/w500/californication.jpg"
    assert first.country == "США"

    assert second.poster_url is None
    assert second.year is None
    assert second.country == "Великобритания"


def test_tmdb_genres_are_russian_and_lowercase():
    provider, _ = tmdb_provider()
    first, second = provider.search(item())
    assert first.genres == ["драма", "комедия"]
    assert second.genres == ["документальный"]


def test_tmdb_tv_request_parameters():
    provider, requests = tmdb_provider()
    provider.search(item())

    search = next(r for r in requests if r.url.path == "/3/search/tv")
    assert search.url.params["query"] == "Californication"
    assert search.url.params["language"] == "ru-RU"
    assert search.url.params["first_air_date_year"] == "2007"
    assert "primary_release_year" not in search.url.params


def test_tmdb_movie_uses_movie_endpoint():
    provider, requests = tmdb_provider()
    candidates = provider.search(item(category="movie", title_original="Inception", release_year=2010))

    search = next(r for r in requests if r.url.path.startswith("/3/search"))
    assert search.url.path == "/3/search/movie"
    assert search.url.params["primary_release_year"] == "2010"
    assert "first_air_date_year" not in search.url.params

    movie = candidates[0]
    assert movie.title == "Начало"
    assert movie.original_title == "Inception"
    assert movie.year == 2010
    assert movie.poster_url == "https://image.tmdb.org/t/p/w500/inception.jpg"
    assert movie.genres == ["боевик", "фантастика", "приключения"]
    assert movie.country is None


@pytest.mark.parametrize("category", ["tv_series", "tv_show", "cartoon"])
def test_tmdb_tv_like_categories_use_tv_endpoint(category):
    provider, requests = tmdb_provider()
    provider.search(item(category=category))
    assert any(r.url.path == "/3/search/tv" for r in requests)


def test_tmdb_searches_by_russian_title_when_no_original():
    provider, requests = tmdb_provider()
    provider.search(item(title_original=None))
    search = next(r for r in requests if r.url.path == "/3/search/tv")
    assert search.url.params["query"] == "Блудливая Калифорния"


def test_tmdb_omits_year_when_unknown():
    provider, requests = tmdb_provider()
    provider.search(item(release_year=None))
    search = next(r for r in requests if r.url.path == "/3/search/tv")
    assert "first_air_date_year" not in search.url.params


def test_tmdb_genre_list_is_loaded_once():
    provider, requests = tmdb_provider()
    provider.search(item())
    provider.search(item(title_original="Other"))
    assert sum(r.url.path == "/3/genre/tv/list" for r in requests) == 1


def test_tmdb_retries_without_year_when_nothing_found():
    requests = []
    tv = load_fixture("tmdb_search_tv.json")

    def handler(request):
        requests.append(request)
        if request.url.path == "/3/search/tv":
            return httpx.Response(200, json={"results": []} if "first_air_date_year" in request.url.params else tv)
        return httpx.Response(200, json=load_fixture("tmdb_genres_tv.json"))

    fetcher, _ = make_fetcher(handler)
    provider = TMDBProvider(api_key="0123456789abcdef", fetcher=fetcher)

    assert len(provider.search(item(release_year=2005))) == 2
    searches = [r for r in requests if r.url.path == "/3/search/tv"]
    assert len(searches) == 2
    assert "first_air_date_year" not in searches[1].url.params


def test_tmdb_no_results():
    provider, requests = tmdb_provider(search_override={"results": []})
    assert provider.search(item(release_year=None)) == []
    assert not any(r.url.path.startswith("/3/genre") for r in requests)


def test_tmdb_v3_key_goes_into_query():
    provider, requests = tmdb_provider(api_key="0123456789abcdef0123456789abcdef")
    provider.search(item())
    assert all(r.url.params["api_key"] == "0123456789abcdef0123456789abcdef" for r in requests)
    assert all("authorization" not in r.headers for r in requests)


def test_tmdb_read_access_token_goes_into_header():
    provider, requests = tmdb_provider(api_key="header.payload.signature")
    provider.search(item())
    assert all(r.headers["authorization"] == "Bearer header.payload.signature" for r in requests)
    assert all("api_key" not in r.url.params for r in requests)


def test_tmdb_rejects_invalid_key():
    fetcher, _ = make_fetcher(lambda request: httpx.Response(401, json={"status_message": "Invalid API key"}))
    provider = TMDBProvider(api_key="bad", fetcher=fetcher)
    with pytest.raises(TMDBAuthError, match="401"):
        provider.search(item())


# --- select_items / run_enrich (тестовая БД) ---

TV_AND_MOVIE = frozenset({"tv_series", "movie", "cartoon", "tv_show"})


class FakeProvider:
    source = "fake"
    categories = TV_AND_MOVIE

    def __init__(self, results):
        self.results = results  # title_ru -> список кандидатов или исключение
        self.calls = []

    def search(self, db_item):
        self.calls.append(db_item.id)
        result = self.results.get(db_item.title_ru, [])
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


def add(db, **overrides):
    data = {"title_ru": "Блудливая Калифорния", "title_original": "Californication", "category": "tv_series",
            "release_year": 2007}
    data.update(overrides)
    row = MediaItem(**data)
    db.add(row)
    db.commit()
    return row


def run(db, items, provider, download=None, dry_run=False):
    return run_enrich(
        db, items, provider_for=lambda row: provider, download=download or (lambda url: (PNG, "image/png")),
        dry_run=dry_run, log=lambda line: None,
    )


def reload(db, row):
    db.expire_all()
    return db.get(MediaItem, row.id)


def test_needs_enrichment(db):
    assert needs_enrichment(add(db))
    full = add(db, title_ru="Полная", title_original="Full", poster_url="/posters/9.jpg", genres=["драма"],
               country="США", release_year=2000)
    assert not needs_enrichment(full)


def test_select_items_filters(db):
    wanted = add(db)
    add(db, title_ru="Полная", title_original="Full", poster_url="/posters/9.jpg", genres=["драма"],
        country="США", release_year=2000)
    add(db, title_ru="Аниме", title_original="Anime", category="anime")  # провайдера для anime нет
    movie = add(db, title_ru="Фильм", title_original="Movie", category="movie")

    assert [i.id for i in select_items(db, TV_AND_MOVIE)] == [wanted.id, movie.id]
    assert [i.id for i in select_items(db, TV_AND_MOVIE, category="movie")] == [movie.id]
    assert [i.id for i in select_items(db, TV_AND_MOVIE, item_id=wanted.id)] == [wanted.id]
    assert [i.id for i in select_items(db, TV_AND_MOVIE, limit=1)] == [wanted.id]


def test_run_enrich_fills_item_and_saves_poster(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": [candidate()]})

    report = run(db, [row], provider)

    assert (report.enriched, report.ambiguous, report.not_found, report.errors) == (1, 0, 0, [])
    saved = reload(db, row)
    assert saved.poster_url == f"/posters/{row.id}.png"
    assert (posters_dir / f"{row.id}.png").read_bytes() == PNG
    assert saved.genres == ["драма", "комедия"]
    assert saved.country == "США"


def test_run_enrich_keeps_manual_edits(db, posters_dir):
    row = add(db, poster_url="https://example.com/my.jpg", genres=["мои жанры"], country="Моя страна", release_year=2007)
    provider = FakeProvider({"Блудливая Калифорния": [candidate()]})

    def forbidden(url):
        raise AssertionError("постер не должен скачиваться, он уже есть")

    report = run(db, [row], provider, download=forbidden)

    assert report.enriched == 0
    assert report.unchanged == 1
    saved = reload(db, row)
    assert (saved.poster_url, saved.genres, saved.country) == ("https://example.com/my.jpg", ["мои жанры"], "Моя страна")
    assert list(posters_dir.iterdir()) == []


def test_run_enrich_marks_ambiguous(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": [candidate(external_id="1"), candidate(external_id="2")]})

    report = run(db, [row], provider)

    assert (report.enriched, report.ambiguous) == (0, 1)
    entry = report.review[0]
    assert entry["id"] == row.id
    assert entry["reason"] == "ambiguous"
    assert entry["title_ru"] == "Блудливая Калифорния"
    assert [c["external_id"] for c in entry["candidates"]] == ["1", "2"]
    assert reload(db, row).poster_url is None


def test_run_enrich_marks_not_found(db, posters_dir):
    row = add(db)
    other = candidate(title="Другое", original_title="Other")
    report = run(db, [row], FakeProvider({"Блудливая Калифорния": [other]}))

    assert (report.enriched, report.not_found) == (0, 1)
    assert report.review[0]["reason"] == "not_found"
    assert report.review[0]["candidates"][0]["original_title"] == "Other"


def test_run_enrich_dry_run_writes_nothing(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": [candidate()]})

    def forbidden(url):
        raise AssertionError("в dry-run постеры не скачиваются")

    report = run(db, [row], provider, download=forbidden, dry_run=True)

    assert report.enriched == 1
    saved = reload(db, row)
    assert saved.poster_url is None
    assert saved.genres in (None, [])
    assert saved.country is None
    assert list(posters_dir.iterdir()) == []


def test_run_enrich_continues_after_search_error(db, posters_dir):
    broken = add(db, title_ru="Сломанный", title_original="Broken")
    good = add(db)
    provider = FakeProvider({"Сломанный": httpx.ConnectError("нет сети"), "Блудливая Калифорния": [candidate()]})

    report = run(db, [broken, good], provider)

    assert report.enriched == 1
    assert len(report.errors) == 1
    assert "Сломанный" in report.errors[0]


def test_run_enrich_stops_on_auth_error(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": TMDBAuthError("ключ не принят")})
    with pytest.raises(TMDBAuthError):
        run(db, [row], provider)


def test_run_enrich_poster_failure_keeps_other_fields(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": [candidate()]})

    def broken_download(url):
        raise httpx.ConnectError("нет сети")

    report = run(db, [row], provider, download=broken_download)

    assert report.enriched == 1
    assert len(report.errors) == 1
    saved = reload(db, row)
    assert saved.genres == ["драма", "комедия"]
    assert saved.poster_url is None  # внешняя ссылка вместо файла не записывается


def test_run_enrich_rejects_non_image_poster(db, posters_dir):
    row = add(db)
    provider = FakeProvider({"Блудливая Калифорния": [candidate()]})

    report = run(db, [row], provider, download=lambda url: (b"<html></html>", "text/html"))

    assert len(report.errors) == 1
    assert reload(db, row).poster_url is None
    assert list(posters_dir.iterdir()) == []


# --- merge_review ---

def test_merge_review_writes_and_merges(tmp_path):
    path = tmp_path / "data" / "enrich_review.json"
    merge_review(path, [{"id": 5, "reason": "ambiguous"}, {"id": 2, "reason": "not_found"}], processed_ids=[2, 5])
    assert [e["id"] for e in json.loads(path.read_text(encoding="utf-8"))] == [2, 5]

    # новый запуск по записям 5 и 9: запись 2 остаётся, 5 разобрана и уходит, 9 добавляется
    merge_review(path, [{"id": 9, "reason": "ambiguous"}], processed_ids=[5, 9])
    assert [e["id"] for e in json.loads(path.read_text(encoding="utf-8"))] == [2, 9]


def test_merge_review_keeps_cyrillic_readable(tmp_path):
    path = tmp_path / "review.json"
    merge_review(path, [{"id": 1, "title_ru": "Блудливая Калифорния"}], processed_ids=[1])
    assert "Блудливая Калифорния" in path.read_text(encoding="utf-8")


def test_merge_review_survives_broken_file(tmp_path):
    path = tmp_path / "review.json"
    path.write_text("{ битый json", encoding="utf-8")
    merge_review(path, [{"id": 1}], processed_ids=[1])
    assert json.loads(path.read_text(encoding="utf-8")) == [{"id": 1}]
