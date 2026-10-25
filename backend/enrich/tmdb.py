"""Клиент TMDB (https://developer.themoviedb.org): поиск сериалов, телепередач, мультсериалов и фильмов."""
import os
from typing import Optional

import httpx

from backend.enrich.base import Candidate, ProviderAuthError, ProviderConfigError, ProviderError
from backend.enrich.client import HttpFetcher

API_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
LANGUAGE = "ru-RU"

# Названия стран по коду ISO 3166-1 (TMDB отдаёт коды, а в базе страны записаны по-русски)
COUNTRY_NAMES = {
    "US": "США", "GB": "Великобритания", "CA": "Канада", "AU": "Австралия", "IE": "Ирландия",
    "RU": "Россия", "SU": "СССР", "UA": "Украина", "BY": "Беларусь", "KZ": "Казахстан",
    "JP": "Япония", "KR": "Южная Корея", "CN": "Китай", "HK": "Гонконг", "TW": "Тайвань",
    "IN": "Индия", "TH": "Таиланд", "FR": "Франция", "DE": "Германия", "IT": "Италия",
    "ES": "Испания", "PT": "Португалия", "NL": "Нидерланды", "BE": "Бельгия", "CH": "Швейцария",
    "AT": "Австрия", "SE": "Швеция", "NO": "Норвегия", "DK": "Дания", "FI": "Финляндия",
    "IS": "Исландия", "PL": "Польша", "CZ": "Чехия", "HU": "Венгрия", "GR": "Греция",
    "TR": "Турция", "IL": "Израиль", "BR": "Бразилия", "MX": "Мексика", "AR": "Аргентина",
    "NZ": "Новая Зеландия", "ZA": "ЮАР",
}


class TMDBError(ProviderError):
    """Ошибка работы с TMDB (текст можно показывать пользователю)."""


class TMDBConfigError(TMDBError, ProviderConfigError):
    """Не задан ключ TMDB."""


class TMDBAuthError(TMDBError, ProviderAuthError):
    """TMDB не принял ключ: продолжать бессмысленно."""


class TMDBProvider:
    source = "tmdb"
    categories = frozenset({"tv_series", "tv_show", "cartoon", "movie"})
    image_hosts = ("image.tmdb.org",)

    def __init__(self, api_key: Optional[str] = None, fetcher: Optional[HttpFetcher] = None, language: str = LANGUAGE):
        api_key = (api_key or os.getenv("TMDB_API_KEY") or "").strip()
        if not api_key:
            raise TMDBConfigError(
                "Не задан TMDB_API_KEY. Получи ключ на https://www.themoviedb.org/settings/api "
                "и впиши его в .env: TMDB_API_KEY=..."
            )
        self.language = language
        self.fetcher = fetcher or HttpFetcher()
        self._genres: dict[str, dict[int, str]] = {}

        # Длинный токен (JWT, «API Read Access Token») передаётся заголовком Bearer, короткий v3-ключ — параметром api_key
        if api_key.count(".") == 2:
            self._headers = {"Authorization": f"Bearer {api_key}"}
            self._auth_params: dict = {}
        else:
            self._headers = {}
            self._auth_params = {"api_key": api_key}

    # --- запросы ---

    def _get(self, path: str, params: dict) -> dict:
        try:
            response = self.fetcher.get(
                f"{API_BASE}{path}", params={**self._auth_params, **params}, headers=self._headers
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise TMDBAuthError("TMDB не принял ключ (401): проверь TMDB_API_KEY в .env") from e
            raise
        return response.json()

    def genre_names(self, kind: str) -> dict[int, str]:
        """Справочник жанров («tv» или «movie») по-русски в нижнем регистре; загружается один раз."""
        if kind not in self._genres:
            data = self._get(f"/genre/{kind}/list", {"language": self.language})
            self._genres[kind] = {g["id"]: g["name"].lower() for g in data.get("genres", [])}
        return self._genres[kind]

    def search(self, item) -> list[Candidate]:
        is_movie = item.category == "movie"
        kind = "movie" if is_movie else "tv"
        query = (item.title_original or item.title_ru or "").strip()
        if not query:
            return []

        params = {"query": query, "language": self.language}
        year_param = "primary_release_year" if is_movie else "first_air_date_year"
        if item.release_year:
            params[year_param] = item.release_year

        results = self._get(f"/search/{kind}", params).get("results", [])
        if not results and item.release_year:
            # Год в нашем списке мог быть неточным: пробуем без него (дальше год всё равно проверит pick_match)
            params.pop(year_param)
            results = self._get(f"/search/{kind}", params).get("results", [])

        genres = self.genre_names(kind) if results else {}
        return [self._to_candidate(kind, result, genres) for result in results]

    # --- разбор ответа ---

    @staticmethod
    def _year(date: Optional[str]) -> Optional[int]:
        if date and date[:4].isdigit():
            return int(date[:4])
        return None

    def _to_candidate(self, kind: str, result: dict, genres: dict[int, str]) -> Candidate:
        if kind == "movie":
            title, original = result.get("title"), result.get("original_title")
            year = self._year(result.get("release_date"))
            country = None  # в ответе поиска по фильмам страны нет
        else:
            title, original = result.get("name"), result.get("original_name")
            year = self._year(result.get("first_air_date"))
            codes = result.get("origin_country") or []
            country = COUNTRY_NAMES.get(codes[0]) if codes else None

        poster_path = result.get("poster_path")
        return Candidate(
            source=self.source,
            external_id=str(result["id"]),
            title=title or "",
            original_title=original or None,
            year=year,
            poster_url=f"{IMAGE_BASE}{poster_path}" if poster_path else None,
            genres=[genres[i] for i in result.get("genre_ids", []) if i in genres],
            country=country,
        )
