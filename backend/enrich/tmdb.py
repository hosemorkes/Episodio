"""Клиент TMDB (https://developer.themoviedb.org): поиск сериалов, телепередач, мультсериалов и фильмов."""
import os
from dataclasses import replace
from typing import Optional

import httpx

from backend.enrich.base import Candidate, ProviderAuthError, ProviderConfigError, ProviderError, search_by_titles
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


# Телепередачи и мультсериалы TMDB отдельной категорией не выделяет, это жанры сериалов
GENRE_ANIMATION = 16
GENRES_SHOW = "10763|10764|10767"  # новости, реалити, ток-шоу

# Статусы сериала, при которых number_of_episodes — это итог, а не число вышедших серий
FINISHED_STATUSES = {"Ended", "Canceled"}


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
        year_param = "primary_release_year" if is_movie else "first_air_date_year"

        def fetch(query: str) -> list[Candidate]:
            params = {"query": query, "language": self.language}
            if item.release_year:
                params[year_param] = item.release_year

            results = self._get(f"/search/{kind}", params).get("results", [])
            if not results and item.release_year:
                # Год в нашем списке мог быть неточным: пробуем без него (дальше год всё равно проверит find_matches)
                params.pop(year_param)
                results = self._get(f"/search/{kind}", params).get("results", [])

            genres = self.genre_names(kind) if results else {}
            return [self._to_candidate(kind, result, genres) for result in results]

        return search_by_titles(item, fetch)

    def popular(self, category: str, limit: int) -> list[Candidate]:
        """Популярное по категории. Сериалы, мультсериалы и ТВ-шоу — один список сериалов, разделённый по жанрам."""
        if category == "movie":
            kind, path, params = "movie", "/movie/popular", {}
        else:
            kind, path = "tv", "/discover/tv"
            params = {"sort_by": "popularity.desc", "vote_count.gte": 50}
            if category == "cartoon":
                params["with_genres"] = GENRE_ANIMATION
            elif category == "tv_show":
                params["with_genres"] = GENRES_SHOW
            else:
                params["without_genres"] = f"{GENRE_ANIMATION},{GENRES_SHOW.replace('|', ',')}"
        results = self._get(path, {"language": self.language, **params}).get("results", [])[:limit]
        genres = self.genre_names(kind) if results else {}
        return [self._to_candidate(kind, result, genres) for result in results]

    def fill_details(self, candidate: Candidate) -> Candidate:
        """Общее число серий сериала (только если он завершён: у идущего итог неизвестен). Фильмам нечего добавлять."""
        if candidate.category is None or candidate.category == "movie":
            return candidate
        data = self._get(f"/tv/{candidate.external_id}", {"language": self.language})
        total = data.get("number_of_episodes")
        if data.get("status") in FINISHED_STATUSES and isinstance(total, int) and total > 0:
            return replace(candidate, total_episodes=total)
        return candidate

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
            rating=round(vote, 1) if (vote := result.get("vote_average")) else None,
        )
