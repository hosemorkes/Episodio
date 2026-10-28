"""Клиент TheTVDB v4 (https://thetvdb.github.io/v4-api/): поиск сериалов, мультсериалов, телепередач и фильмов.

Правила API: ключ (TVDB_API_KEY) обменивается на токен запросом POST /login, токен живёт месяц и передаётся заголовком
Bearer. Токен берётся при первом запросе и обновляется один раз, если сервер ответил 401. Для ключей с подпиской
(«user supported key») нужен ещё PIN (TVDB_PIN), для бесплатных проектных ключей он не нужен.

В результатах поиска название оригинальное (name), перевод лежит в translations["rus"], жанры приходят по-английски
(их переводит GENRES), страна — трёхбуквенным кодом (COUNTRY_CODES). Общего числа серий и оценки в поиске нет.
"""
import os
from typing import Optional

import httpx

from backend.enrich.base import (
    Candidate,
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    search_queries,
)
from backend.enrich.client import HttpFetcher
from backend.enrich.tmdb import COUNTRY_NAMES

API_BASE = "https://api4.thetvdb.com/v4"
RESULTS_LIMIT = 10
RUSSIAN = "rus"

# Трёхбуквенные коды стран TheTVDB -> двухбуквенные (дальше названия берутся из COUNTRY_NAMES)
COUNTRY_CODES = {
    "usa": "US", "gbr": "GB", "can": "CA", "aus": "AU", "irl": "IE", "rus": "RU", "ukr": "UA", "blr": "BY", "kaz": "KZ",
    "jpn": "JP", "kor": "KR", "chn": "CN", "hkg": "HK", "twn": "TW", "ind": "IN", "tha": "TH", "fra": "FR", "deu": "DE",
    "ita": "IT", "esp": "ES", "prt": "PT", "nld": "NL", "bel": "BE", "che": "CH", "aut": "AT", "swe": "SE", "nor": "NO",
    "dnk": "DK", "fin": "FI", "isl": "IS", "pol": "PL", "cze": "CZ", "hun": "HU", "grc": "GR", "tur": "TR", "isr": "IL",
    "bra": "BR", "mex": "MX", "arg": "AR", "nzl": "NZ", "zaf": "ZA",
}

# Жанры TheTVDB -> жанры библиотеки (по-русски, в нижнем регистре, как у TMDB). Неизвестные остаются английскими
GENRES = {
    "Action": "боевик", "Adventure": "приключения", "Animation": "мультфильм", "Anime": "аниме", "Biography": "биография",
    "Children": "для детей", "Comedy": "комедия", "Crime": "криминал", "Documentary": "документальный",
    "Drama": "драма", "Family": "семейный", "Fantasy": "фэнтези", "Food": "кулинария", "Game Show": "игровое шоу",
    "History": "исторический", "Horror": "ужасы", "Mini-Series": "мини-сериал", "Music": "музыка", "Musical": "мюзикл",
    "Mystery": "детектив", "News": "новости", "Reality": "реалити", "Romance": "мелодрама",
    "Science Fiction": "фантастика", "Soap": "мыльная опера", "Sport": "спорт", "Suspense": "триллер",
    "Talk Show": "ток-шоу", "Thriller": "триллер", "War": "военный", "Western": "вестерн",
}


class TVDBError(ProviderError):
    """Ошибка работы с TheTVDB (текст можно показывать пользователю)."""


class TVDBConfigError(TVDBError, ProviderConfigError):
    """Не задан ключ TheTVDB."""


class TVDBAuthError(TVDBError, ProviderAuthError):
    """TheTVDB не принял ключ: продолжать бессмысленно."""


def translate_genres(names: list[str]) -> list[str]:
    return [GENRES.get(name, name.lower()) for name in names if name]


class TVDBProvider:
    source = "tvdb"
    categories = frozenset({"tv_series", "tv_show", "cartoon", "movie"})
    image_hosts = ("artworks.thetvdb.com",)

    def __init__(self, api_key: Optional[str] = None, fetcher: Optional[HttpFetcher] = None, pin: Optional[str] = None):
        api_key = (api_key or os.getenv("TVDB_API_KEY") or "").strip()
        if not api_key:
            raise TVDBConfigError(
                "Не задан TVDB_API_KEY. Получи ключ на https://thetvdb.com/dashboard/account/apikey "
                "и впиши его в .env: TVDB_API_KEY=..."
            )
        self._api_key = api_key
        self._pin = (pin or os.getenv("TVDB_PIN") or "").strip() or None
        self.fetcher = fetcher or HttpFetcher()
        self._token: Optional[str] = None

    # --- запросы ---

    def _login(self) -> str:
        body = {"apikey": self._api_key}
        if self._pin:
            body["pin"] = self._pin
        try:
            response = self.fetcher.post(f"{API_BASE}/login", json=body)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise TVDBAuthError("TheTVDB не принял ключ (401): проверь TVDB_API_KEY (и TVDB_PIN) в .env") from e
            raise
        token = ((response.json() or {}).get("data") or {}).get("token")
        if not token:
            raise TVDBError("TheTVDB не вернул токен авторизации")
        return token

    def _get(self, path: str, params: dict) -> dict:
        for attempt in range(2):
            if self._token is None:
                self._token = self._login()
            try:
                response = self.fetcher.get(
                    f"{API_BASE}{path}", params=params, headers={"Authorization": f"Bearer {self._token}"}
                )
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    self._token = None  # токен истёк: один раз получаем новый
                    if attempt == 0:
                        continue
                    raise TVDBAuthError("TheTVDB отказал в доступе (401): проверь TVDB_API_KEY в .env") from e
                raise
            return response.json()
        raise AssertionError("недостижимо")

    # --- поиск ---

    def search(self, item) -> list[Candidate]:
        kind = "movie" if item.category == "movie" else "series"
        for query in search_queries(item):
            params = {"query": query, "type": kind, "limit": RESULTS_LIMIT}
            if item.release_year:
                params["year"] = item.release_year
            results = self._get("/search", params).get("data") or []
            if not results and item.release_year:
                # Год в нашем списке мог быть неточным: пробуем без него (дальше год всё равно проверит find_matches)
                params.pop("year")
                results = self._get("/search", params).get("data") or []
            if results:
                return [self._to_candidate(result) for result in results]
        return []

    # --- разбор ответа ---

    @staticmethod
    def _year(value) -> Optional[int]:
        text = str(value or "")
        return int(text[:4]) if text[:4].isdigit() else None

    def _to_candidate(self, result: dict) -> Candidate:
        translations = result.get("translations") or {}
        original = (result.get("name") or "").strip() or None
        title = (translations.get(RUSSIAN) or "").strip() or original or ""
        code = COUNTRY_CODES.get((result.get("country") or "").lower())
        return Candidate(
            source=self.source,
            external_id=str(result.get("tvdb_id") or result.get("id") or "").removeprefix("series-").removeprefix("movie-"),
            title=title,
            original_title=original,
            year=self._year(result.get("year")),
            poster_url=result.get("image_url") or None,
            genres=translate_genres(result.get("genres") or []),
            country=COUNTRY_NAMES.get(code) if code else None,
        )
