"""Клиент AniList (https://anilist.gitbook.io/anilist-apiv2-docs): поиск и популярное по аниме и манге, GraphQL.

Правила API: ключ не нужен, лимит 90 запросов в минуту. Название по-русски в AniList нет: заголовок берётся английский
(иначе ромадзи), оригинальным названием остаётся ромадзи (как у Shikimori, поэтому поиск и сопоставление работают одинаково).
Жанры приходят по-английски, их переводит GENRES (названия совпадают с жанрами Shikimori, чтобы в библиотеке не было дублей).
Общее число серий и глав приходит прямо в списках, оценка — averageScore (0–100), в Candidate она по 10-балльной шкале.
"""
from dataclasses import replace
from typing import Optional

from backend.enrich.base import Candidate, ProviderError, search_queries
from backend.enrich.client import HttpFetcher
from backend.enrich.tmdb import COUNTRY_NAMES

API_URL = "https://graphql.anilist.co"
RESULTS_LIMIT = 10
RESULTS_MAX = 50  # максимум на страницу по документации

# 90 запросов в минуту -> не чаще одного запроса в 0,7 с (с запасом под лимит)
MIN_INTERVAL = 0.7

# категория -> (MediaType AniList, тип в external_id)
TYPES = {"anime": ("ANIME", "anime"), "manga": ("MANGA", "manga")}

# Жанры AniList -> жанры библиотеки (по-русски, в нижнем регистре, как у Shikimori). Неизвестные остаются английскими
GENRES = {
    "Action": "экшен", "Adventure": "приключения", "Comedy": "комедия", "Drama": "драма", "Ecchi": "этти",
    "Fantasy": "фэнтези", "Hentai": "хентай", "Horror": "ужасы", "Mahou Shoujo": "махо-сёдзё", "Mecha": "меха",
    "Music": "музыка", "Mystery": "детектив", "Psychological": "психологическое", "Romance": "романтика",
    "Sci-Fi": "фантастика", "Slice of Life": "повседневность", "Sports": "спорт", "Supernatural": "сверхъестественное",
    "Thriller": "триллер",
}

MEDIA_FIELDS = """
  id
  title { romaji english }
  startDate { year }
  coverImage { extraLarge large }
  genres
  averageScore
  episodes
  chapters
  countryOfOrigin
"""

SEARCH_QUERY = f"""
query ($search: String, $type: MediaType, $perPage: Int) {{
  Page(page: 1, perPage: $perPage) {{
    media(search: $search, type: $type, sort: SEARCH_MATCH) {{ {MEDIA_FIELDS} }}
  }}
}}
"""

POPULAR_QUERY = f"""
query ($type: MediaType, $perPage: Int) {{
  Page(page: 1, perPage: $perPage) {{
    media(type: $type, sort: POPULARITY_DESC) {{ {MEDIA_FIELDS} }}
  }}
}}
"""

DETAILS_QUERY = """
query ($id: Int, $type: MediaType) {
  Media(id: $id, type: $type) { genres episodes chapters }
}
"""


class AniListError(ProviderError):
    """Ошибка работы с AniList (текст можно показывать пользователю)."""


def translate_genres(names: list[str]) -> list[str]:
    return [GENRES.get(name, name.lower()) for name in names if name]


class AniListProvider:
    source = "anilist"
    categories = frozenset(TYPES)
    image_hosts = ("s4.anilist.co",)

    def __init__(self, fetcher: Optional[HttpFetcher] = None, api_url: str = API_URL):
        self.api_url = api_url
        self.fetcher = fetcher or HttpFetcher(min_interval=MIN_INTERVAL)

    def _query(self, query: str, variables: dict) -> dict:
        response = self.fetcher.post(self.api_url, json={"query": query, "variables": variables})
        body = response.json()
        errors = body.get("errors")
        if errors and not body.get("data"):
            message = errors[0].get("message") if isinstance(errors[0], dict) else str(errors[0])
            raise AniListError(f"AniList вернул ошибку: {message}")
        return body.get("data") or {}

    def search(self, item) -> list[Candidate]:
        media_type, kind = TYPES[item.category]
        for query in search_queries(item):
            data = self._query(SEARCH_QUERY, {"search": query, "type": media_type, "perPage": RESULTS_LIMIT})
            media = ((data.get("Page") or {}).get("media")) or []
            if media:
                return [self._to_candidate(kind, m) for m in media]
        return []

    def popular(self, category: str, limit: int) -> list[Candidate]:
        """Самое популярное (порядок POPULARITY_DESC); у аниме и манги отдельные списки."""
        media_type, kind = TYPES[category]
        data = self._query(POPULAR_QUERY, {"type": media_type, "perPage": min(limit, RESULTS_MAX)})
        return [self._to_candidate(kind, m) for m in ((data.get("Page") or {}).get("media")) or []]

    def fill_details(self, candidate: Candidate) -> Candidate:
        """Общее число серий или глав (и жанры, если их ещё нет): 0 и null — число неизвестно."""
        kind, _, anilist_id = candidate.external_id.partition(":")
        media_type = next(t for t, k in TYPES.values() if k == kind)
        media = self._query(DETAILS_QUERY, {"id": int(anilist_id), "type": media_type}).get("Media") or {}
        details = {"total_episodes": media.get("episodes") or None} if kind == "anime" else {"total_chapters": media.get("chapters") or None}
        return replace(candidate, genres=candidate.genres or translate_genres(media.get("genres") or []), **details)

    # --- разбор ответа ---

    @staticmethod
    def _to_candidate(kind: str, media: dict) -> Candidate:
        title = media.get("title") or {}
        romaji = title.get("romaji") or None
        cover = media.get("coverImage") or {}
        score = media.get("averageScore")
        return Candidate(
            source="anilist",
            external_id=f"{kind}:{media['id']}",
            title=title.get("english") or romaji or "",
            original_title=romaji,
            year=(media.get("startDate") or {}).get("year"),
            poster_url=cover.get("extraLarge") or cover.get("large"),
            genres=translate_genres(media.get("genres") or []),
            country=COUNTRY_NAMES.get(media.get("countryOfOrigin") or ""),
            rating=round(score / 10, 1) if score else None,
            total_episodes=(media.get("episodes") or None) if kind == "anime" else None,
            total_chapters=(media.get("chapters") or None) if kind == "manga" else None,
        )
