"""Тесты провайдеров Shikimori и Open Library и выбора провайдера по категории. Сеть не используется."""
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from backend import posters
from backend.enrich.base import Candidate, ProviderAuthError, ProviderError, find_matches, search_queries
from backend.enrich.client import HttpFetcher
from backend.enrich.openlibrary import OpenLibraryProvider
from backend.enrich.shikimori import ShikimoriError, ShikimoriProvider
from backend.enrich.tmdb import TMDBProvider
from backend.models import MediaItem
from scripts import enrich
from scripts.enrich import build_providers, make_downloader, run_enrich

FIXTURES = Path(__file__).parent / "fixtures"
PNG = b"\x89PNG\r\n\x1a\n" + b"png-data"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def item(**overrides):
    data = {
        "id": 1, "title_ru": "Атака титанов", "title_original": "Shingeki no Kyojin", "category": "anime",
        "release_year": 2013, "poster_url": None, "genres": [], "country": None, "author": None,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def make_fetcher(handler, **kwargs):
    kwargs.setdefault("min_interval", 0.0)
    return HttpFetcher(transport=httpx.MockTransport(handler), sleep=lambda seconds: None, **kwargs)


# --- search_queries ---

def test_search_queries_original_first_without_duplicates():
    assert search_queries(item()) == ["Shingeki no Kyojin", "Атака титанов"]
    assert search_queries(item(title_original=None)) == ["Атака титанов"]
    assert search_queries(item(title_original="Атака титанов")) == ["Атака титанов"]
    assert search_queries(item(title_original="  ", title_ru="")) == []


# --- Shikimori ---

def shikimori(handler=None, **kwargs):
    """Провайдер Shikimori с заготовленными ответами. Возвращает (провайдер, список запросов)."""
    requests = []

    def default_handler(request):
        path = request.url.path
        if path == "/api/animes":
            return httpx.Response(200, json=load_fixture("shikimori_animes.json"))
        if path == "/api/mangas":
            return httpx.Response(200, json=load_fixture("shikimori_mangas.json"))
        if path == "/api/animes/16498":
            return httpx.Response(200, json=load_fixture("shikimori_anime_show.json"))
        if path == "/api/mangas/2":
            return httpx.Response(200, json=load_fixture("shikimori_manga_show.json"))
        return httpx.Response(404)

    def recording(request):
        requests.append(request)
        return (handler or default_handler)(request)

    kwargs.setdefault("user_agent", "Episodio-tests")
    provider = ShikimoriProvider(fetcher=make_fetcher(recording, user_agent=kwargs["user_agent"]), **kwargs)
    return provider, requests


def test_shikimori_requires_user_agent(monkeypatch):
    monkeypatch.delenv("SHIKIMORI_USER_AGENT", raising=False)
    with pytest.raises(ShikimoriError, match="SHIKIMORI_USER_AGENT"):
        ShikimoriProvider()
    assert issubclass(ShikimoriError, ProviderError)


def test_shikimori_reads_user_agent_from_environment(monkeypatch):
    monkeypatch.setenv("SHIKIMORI_USER_AGENT", "Episodio-env")
    ShikimoriProvider(fetcher=make_fetcher(lambda request: httpx.Response(200, json=[])))


def test_shikimori_default_fetcher_respects_rate_limit():
    provider = ShikimoriProvider(user_agent="Episodio-tests")
    assert provider.fetcher._limiter.min_interval >= 60 / 90  # не больше 90 запросов в минуту
    provider.fetcher.close()


def test_shikimori_sends_user_agent():
    provider, requests = shikimori()
    provider.search(item())
    assert all(r.headers["user-agent"] == "Episodio-tests" for r in requests)


def test_shikimori_parses_anime_results():
    provider, requests = shikimori()
    first, second = provider.search(item())

    assert requests[0].url.path == "/api/animes"
    assert requests[0].url.params["search"] == "Shingeki no Kyojin"
    assert int(requests[0].url.params["limit"]) <= 50

    assert first.source == "shikimori"
    assert first.external_id == "anime:16498"
    assert first.title == "Атака титанов"
    assert first.original_title == "Shingeki no Kyojin"
    assert first.year == 2013
    # относительный путь картинки превращён в полный URL
    assert first.poster_url == "https://shikimori.io/system/animes/original/16498.jpg?1711973439"
    assert first.genres == []  # в списке результатов жанров нет
    assert first.author is None

    assert second.year is None
    assert second.poster_url is None  # заглушка «нет картинки» постером не считается


def test_shikimori_parses_manga_results():
    provider, requests = shikimori()
    [manga] = provider.search(item(category="manga", title_ru="Берсерк", title_original="Berserk"))

    assert requests[0].url.path == "/api/mangas"
    assert manga.external_id == "manga:2"
    assert manga.title == "Берсерк"
    assert manga.original_title == "Berserk"
    assert manga.year == 1989
    assert manga.poster_url == "https://shikimori.io/system/mangas/original/2.jpg?1712722988"
    assert manga.author is None  # API автора не отдаёт


def test_shikimori_falls_back_to_russian_title():
    def handler(request):
        if request.url.params["search"] == "Атака титанов":
            return httpx.Response(200, json=load_fixture("shikimori_animes.json"))
        return httpx.Response(200, json=[])

    provider, requests = shikimori(handler)
    assert len(provider.search(item())) == 2
    assert [r.url.params["search"] for r in requests] == ["Shingeki no Kyojin", "Атака титанов"]


def test_shikimori_no_results():
    provider, _ = shikimori(lambda request: httpx.Response(200, json=[]))
    assert provider.search(item()) == []


def test_shikimori_fill_details_adds_russian_lowercase_genres():
    provider, requests = shikimori()
    candidate = provider.search(item())[0]
    detailed = provider.fill_details(candidate)

    assert requests[-1].url.path == "/api/animes/16498"
    assert detailed.genres == ["сёнен", "экшен", "драма"]
    assert candidate.genres == []  # исходный кандидат не изменён
    assert detailed.external_id == candidate.external_id


def test_shikimori_fill_details_for_manga():
    provider, requests = shikimori()
    candidate = provider.search(item(category="manga", title_original="Berserk"))[0]

    assert provider.fill_details(candidate).genres == ["экшен", "приключения"]
    assert requests[-1].url.path == "/api/mangas/2"


def test_shikimori_custom_base_url(monkeypatch):
    monkeypatch.setenv("SHIKIMORI_BASE_URL", "https://shikimori.example/")
    provider, _ = shikimori(base_url=None)
    assert provider.image_hosts == ("shikimori.example",)
    assert provider.search(item())[0].poster_url.startswith("https://shikimori.example/system/animes/")


def test_shikimori_match_picks_exact_anime_only():
    provider, _ = shikimori()
    matches = find_matches(item(), provider.search(item()))
    assert [c.external_id for c in matches] == ["anime:16498"]


# --- Open Library ---

def openlibrary(handler=None, **kwargs):
    requests = []

    def default_handler(request):
        return httpx.Response(200, json=load_fixture("openlibrary_search.json"))

    def recording(request):
        requests.append(request)
        return (handler or default_handler)(request)

    return OpenLibraryProvider(fetcher=make_fetcher(recording), **kwargs), requests


def book(**overrides):
    data = {"title_ru": "Дюна", "title_original": "Dune", "category": "book", "release_year": 1965, "author": None}
    data.update(overrides)
    return item(**data)


def test_openlibrary_parses_results():
    provider, requests = openlibrary()
    dune, messiah = provider.search(book())

    params = requests[0].url.params
    assert requests[0].url.path == "/search.json"
    assert params["title"] == "Dune"
    assert "cover_i" in params["fields"] and "first_publish_year" in params["fields"]
    assert "author" not in params

    assert dune.source == "openlibrary"
    assert dune.external_id == "/works/OL893414W"
    assert dune.title == "Dune"
    assert dune.author == "Frank Herbert"
    assert dune.year == 1965
    assert dune.poster_url == "https://covers.openlibrary.org/b/id/11481354-L.jpg?default=false"
    assert messiah.poster_url is None  # cover_i нет — обложки нет


def test_openlibrary_searches_with_author_when_known():
    provider, requests = openlibrary()
    provider.search(book(author="Frank Herbert"))
    assert requests[0].url.params["author"] == "Frank Herbert"


def test_openlibrary_retries_without_author_when_nothing_found():
    def handler(request):
        if "author" in request.url.params:
            return httpx.Response(200, json={"docs": []})
        return httpx.Response(200, json=load_fixture("openlibrary_search.json"))

    provider, requests = openlibrary(handler)
    assert len(provider.search(book(author="Фрэнк Герберт"))) == 2
    assert ["author" in r.url.params for r in requests] == [True, False]


def test_openlibrary_falls_back_to_russian_title():
    def handler(request):
        if request.url.params["title"] == "Дюна":
            return httpx.Response(200, json=load_fixture("openlibrary_search.json"))
        return httpx.Response(200, json={"docs": []})

    provider, requests = openlibrary(handler)
    assert len(provider.search(book())) == 2
    assert [r.url.params["title"] for r in requests] == ["Dune", "Дюна"]


def test_openlibrary_no_results():
    provider, _ = openlibrary(lambda request: httpx.Response(200, json={"docs": []}))
    assert provider.search(book()) == []


def test_openlibrary_match_picks_exact_title_only():
    provider, _ = openlibrary()
    matches = find_matches(book(), provider.search(book()))
    assert [c.title for c in matches] == ["Dune"]


@pytest.mark.parametrize(
    "user_agent, expected",
    [(None, 1.1), ("Episodio (me@example.com)", 0.4)],
)
def test_openlibrary_rate_limit_depends_on_identification(monkeypatch, user_agent, expected):
    monkeypatch.delenv("OPENLIBRARY_USER_AGENT", raising=False)
    provider = OpenLibraryProvider(user_agent=user_agent)
    assert provider.fetcher._limiter.min_interval == expected
    provider.fetcher.close()


def test_openlibrary_needs_no_configuration(monkeypatch):
    monkeypatch.delenv("OPENLIBRARY_USER_AGENT", raising=False)
    OpenLibraryProvider().fetcher.close()


# --- build_providers / make_downloader ---

@pytest.fixture
def clean_env(monkeypatch):
    for name in ("TMDB_API_KEY", "SHIKIMORI_USER_AGENT", "OPENLIBRARY_USER_AGENT"):
        monkeypatch.delenv(name, raising=False)

    def forbidden():
        raise AssertionError("тест открыл рабочую базу: SessionLocal нужно подменить (см. test_main_dispatches_by_category)")

    # main() обращается к SessionLocal; без подмены он подключился бы к рабочей базе из .env
    monkeypatch.setattr(enrich, "SessionLocal", forbidden)
    return monkeypatch


def sources(providers):
    return sorted(provider.source for provider in providers)


def test_build_providers_for_category(clean_env):
    clean_env.setenv("SHIKIMORI_USER_AGENT", "Episodio-tests")
    providers, skipped = build_providers("anime")
    assert sources(providers) == ["anilist", "shikimori"]  # у аниме два источника, AniList ничего не требует
    assert skipped == []
    providers, skipped = build_providers("anime", "shikimori")
    assert sources(providers) == ["shikimori"]
    providers, skipped = build_providers("book")
    assert sources(providers) == ["openlibrary"]


def test_build_providers_source_filter(clean_env):
    providers, skipped = build_providers("manga", "anilist")
    assert sources(providers) == ["anilist"] and skipped == []
    providers, skipped = build_providers("movie", "anilist")  # AniList кино не обслуживает
    assert providers == [] and skipped == []


def test_build_providers_reports_missing_settings_for_category(clean_env):
    providers, skipped = build_providers("anime", "shikimori")
    assert providers == []
    assert "SHIKIMORI_USER_AGENT" in skipped[0]

    providers, skipped = build_providers("movie")
    assert providers == []
    assert "TMDB_API_KEY" in skipped[0]


def test_build_providers_skips_unconfigured_ones(clean_env):
    providers, skipped = build_providers(None)
    assert sources(providers) == ["anilist", "openlibrary"]
    assert len(skipped) == 2


def test_build_providers_all_configured(clean_env):
    clean_env.setenv("TMDB_API_KEY", "key")
    clean_env.setenv("SHIKIMORI_USER_AGENT", "Episodio-tests")
    providers, skipped = build_providers(None)
    assert sources(providers) == ["anilist", "openlibrary", "shikimori", "tmdb"]
    assert skipped == []


def test_every_category_has_a_default_provider():
    owners = {}
    for cls in enrich.PROVIDER_CLASSES:
        for category in cls.categories:
            owners.setdefault(category, []).append(cls.source)
    assert set(owners) == {"tv_series", "tv_show", "cartoon", "movie", "anime", "manga", "book", "audiobook"}
    # источник по умолчанию — первый в списке: у аниме и манги это Shikimori, AniList выбирается явно
    assert owners["anime"] == owners["manga"] == ["shikimori", "anilist"]
    assert all(len(sources_) == 1 for category, sources_ in owners.items() if category not in ("anime", "manga"))


def test_downloader_routes_by_host():
    def fetcher_returning(content):
        return make_fetcher(lambda request: httpx.Response(200, content=content, headers={"content-type": "image/png"}))

    providers = [
        SimpleNamespace(fetcher=fetcher_returning(b"from-shikimori"), image_hosts=("shikimori.io",)),
        SimpleNamespace(fetcher=fetcher_returning(b"from-covers"), image_hosts=("covers.openlibrary.org",)),
    ]
    download = make_downloader(providers)

    assert download("https://shikimori.io/system/animes/original/1.jpg?1") == (b"from-shikimori", "image/png")
    assert download("https://covers.openlibrary.org/b/id/1-L.jpg") == (b"from-covers", "image/png")
    with pytest.raises(ProviderError, match="Неизвестный источник"):
        download("https://evil.example/x.png")


# --- fill_details в run_enrich (тестовая БД) ---

class DetailedProvider:
    source = "fake"
    categories = frozenset({"anime"})
    image_hosts = ()
    fetcher = None

    def __init__(self, candidate, fail_details=False):
        self.candidate = candidate
        self.fail_details = fail_details
        self.detail_calls = 0

    def search(self, db_item):
        return [self.candidate]

    def fill_details(self, candidate):
        self.detail_calls += 1
        if self.fail_details:
            raise httpx.ConnectError("нет сети")
        return Candidate(**{**candidate.__dict__, "genres": ["экшен"]})


@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


def add_anime(db, **overrides):
    data = {"title_ru": "Атака титанов", "title_original": "Shingeki no Kyojin", "category": "anime", "release_year": 2013}
    data.update(overrides)
    row = MediaItem(**data)
    db.add(row)
    db.commit()
    return row


def anime_candidate():
    return Candidate(source="fake", external_id="anime:1", title="Атака титанов", original_title="Shingeki no Kyojin",
                     year=2013, poster_url="https://shikimori.io/system/animes/original/1.jpg")


def run(db, row, provider, dry_run=False):
    return run_enrich(db, [row], provider_for=lambda r: provider, download=lambda url: (PNG, "image/png"),
                      dry_run=dry_run, log=lambda line: None)


def test_run_enrich_fills_genres_from_details(db, posters_dir):
    row = add_anime(db)
    provider = DetailedProvider(anime_candidate())

    report = run(db, row, provider)

    assert (report.enriched, report.errors) == (1, [])
    assert provider.detail_calls == 1
    db.expire_all()
    saved = db.get(MediaItem, row.id)
    assert saved.genres == ["экшен"]
    assert saved.poster_url == f"/posters/{row.id}.png"


def test_run_enrich_skips_details_when_genres_already_set(db, posters_dir):
    row = add_anime(db, genres=["мои жанры"])
    provider = DetailedProvider(anime_candidate())

    run(db, row, provider)

    assert provider.detail_calls == 0
    db.expire_all()
    assert db.get(MediaItem, row.id).genres == ["мои жанры"]


def test_run_enrich_details_failure_is_reported_but_item_still_enriched(db, posters_dir):
    row = add_anime(db)
    provider = DetailedProvider(anime_candidate(), fail_details=True)

    report = run(db, row, provider)

    assert report.enriched == 1
    assert len(report.errors) == 1 and "детали" in report.errors[0]
    db.expire_all()
    saved = db.get(MediaItem, row.id)
    assert saved.poster_url == f"/posters/{row.id}.png"
    assert not saved.genres


def test_run_enrich_poster_from_unknown_host_is_an_error_not_a_crash(db, posters_dir):
    row = add_anime(db)
    provider = DetailedProvider(anime_candidate())

    def unknown_host(url):
        raise ProviderError(f"Неизвестный источник картинки: {url}")

    report = run_enrich(db, [row], provider_for=lambda r: provider, download=unknown_host, log=lambda line: None)

    assert report.enriched == 1  # жанры всё равно сохранены
    assert len(report.errors) == 1 and "постер" in report.errors[0]
    db.expire_all()
    assert db.get(MediaItem, row.id).poster_url is None


def test_run_enrich_stops_on_provider_auth_error(db, posters_dir):
    row = add_anime(db)

    class Denied(DetailedProvider):
        def search(self, db_item):
            raise ProviderAuthError("доступ запрещён")

    with pytest.raises(ProviderAuthError):
        run(db, row, Denied(anime_candidate()))


# --- main ---

def test_main_anime_without_user_agent_returns_2(clean_env, capsys):
    clean_env.setattr(enrich, "load_dotenv", lambda *args, **kwargs: None)
    assert enrich.main(["--category", "anime", "--source", "shikimori"]) == 2
    assert "SHIKIMORI_USER_AGENT" in capsys.readouterr().err


def test_main_movie_without_api_key_returns_2(clean_env, capsys):
    clean_env.setattr(enrich, "load_dotenv", lambda *args, **kwargs: None)
    assert enrich.main(["--category", "movie"]) == 2
    assert "TMDB_API_KEY" in capsys.readouterr().err


def test_main_dispatches_by_category(db, posters_dir, tmp_path, monkeypatch, capsys):
    """main() выбирает провайдера по категории записи и обогащает только её."""
    anime = add_anime(db)
    movie = add_anime(db, title_ru="Начало", title_original="Inception", category="movie", release_year=2010)
    provider = DetailedProvider(anime_candidate())
    provider.image_hosts = ("shikimori.io",)
    provider.fetcher = make_fetcher(lambda request: httpx.Response(200, content=PNG, headers={"content-type": "image/png"}))

    class NoCloseSession:
        def __getattr__(self, name):
            return getattr(db, name)

        def close(self):
            pass

    monkeypatch.setattr(enrich, "load_dotenv", lambda *args, **kwargs: None)
    monkeypatch.setattr(enrich, "SessionLocal", lambda: NoCloseSession())
    monkeypatch.setattr(enrich, "REVIEW_PATH", tmp_path / "review.json")
    monkeypatch.setattr(enrich, "build_providers", lambda category, source=None: ([provider], []))

    assert enrich.main([]) == 0

    db.expire_all()
    assert db.get(MediaItem, anime.id).genres == ["экшен"]
    assert db.get(MediaItem, movie.id).genres in (None, [])  # для movie провайдера не было
    assert "Обогащено: 1" in capsys.readouterr().out


def test_main_uses_first_provider_by_default_and_source_picks_another(db, posters_dir, tmp_path, monkeypatch, capsys):
    """У аниме два источника: без --source работает первый (Shikimori), AniList только по выбору."""
    first = DetailedProvider(anime_candidate())
    first.source = "shikimori"
    second = DetailedProvider(anime_candidate())
    second.source = "anilist"
    def arm():
        # main() закрывает клиентов провайдеров в конце, поэтому перед каждым запуском они создаются заново
        for provider in (first, second):
            provider.image_hosts = ("shikimori.io",)
            provider.fetcher = make_fetcher(lambda request: httpx.Response(200, content=PNG, headers={"content-type": "image/png"}))


    class NoCloseSession:
        def __getattr__(self, name):
            return getattr(db, name)

        def close(self):
            pass

    def fake_build(category, source=None):
        providers = [p for p in (first, second) if source in (None, p.source)]
        return providers, []

    monkeypatch.setattr(enrich, "load_dotenv", lambda *args, **kwargs: None)
    monkeypatch.setattr(enrich, "SessionLocal", lambda: NoCloseSession())
    monkeypatch.setattr(enrich, "REVIEW_PATH", tmp_path / "review.json")
    monkeypatch.setattr(enrich, "build_providers", fake_build)

    add_anime(db)
    arm()
    assert enrich.main(["--category", "anime"]) == 0
    assert (first.detail_calls, second.detail_calls) == (1, 0)

    add_anime(db, title_ru="Атака титанов (копия)")
    arm()
    assert enrich.main(["--category", "anime", "--source", "anilist"]) == 0
    assert second.detail_calls == 1
