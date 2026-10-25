"""Клиент Shikimori (https://shikimori.io/api/doc/1.0): поиск аниме и манги.

Правила API: не больше 5 запросов в секунду и 90 в минуту; каждый запрос подписывается названием
приложения в User-Agent (его нельзя подделывать под браузер).

В ответе поиска нет жанров, а у манги нет автора. Жанры подгружает fill_details отдельным запросом, но
только для выбранного кандидата. Автор манги в API Shikimori отдельным полем не приходит, поэтому остаётся пустым.
"""
import os
from dataclasses import replace
from typing import Optional
from urllib.parse import urljoin, urlparse

from backend.enrich.base import Candidate, ProviderConfigError, ProviderError, search_queries
from backend.enrich.client import HttpFetcher

DEFAULT_BASE_URL = "https://shikimori.io"
RESULTS_LIMIT = 10  # максимум по документации — 50

# 90 запросов в минуту -> не чаще одного запроса в 0,7 с (с запасом под лимит)
MIN_INTERVAL = 0.7

# категория -> (ресурс API, тип в external_id)
RESOURCES = {"anime": ("animes", "anime"), "manga": ("mangas", "manga")}


class ShikimoriError(ProviderError):
    """Ошибка работы с Shikimori (текст можно показывать пользователю)."""


class ShikimoriConfigError(ShikimoriError, ProviderConfigError):
    """Не задан User-Agent для Shikimori."""


class ShikimoriProvider:
    source = "shikimori"
    categories = frozenset(RESOURCES)

    def __init__(
        self,
        user_agent: Optional[str] = None,
        base_url: Optional[str] = None,
        fetcher: Optional[HttpFetcher] = None,
    ):
        user_agent = (user_agent or os.getenv("SHIKIMORI_USER_AGENT") or "").strip()
        if not user_agent:
            raise ShikimoriConfigError(
                "Не задан SHIKIMORI_USER_AGENT. Shikimori требует подписывать запросы названием приложения: "
                "впиши в .env, например, SHIKIMORI_USER_AGENT=Episodio"
            )
        self.base_url = (base_url or os.getenv("SHIKIMORI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.fetcher = fetcher or HttpFetcher(user_agent=user_agent, min_interval=MIN_INTERVAL)
        self.image_hosts = (urlparse(self.base_url).hostname or "",)

    def _get(self, path: str, params: Optional[dict] = None):
        return self.fetcher.get(f"{self.base_url}{path}", params=params).json()

    def search(self, item) -> list[Candidate]:
        resource, kind = RESOURCES[item.category]
        for query in search_queries(item):
            results = self._get(f"/api/{resource}", {"search": query, "limit": RESULTS_LIMIT})
            if results:
                return [self._to_candidate(kind, result) for result in results]
        return []

    def fill_details(self, candidate: Candidate) -> Candidate:
        """Жанры по-русски в нижнем регистре: в списке результатов их нет, они приходят с карточкой."""
        kind, _, shiki_id = candidate.external_id.partition(":")
        resource = next(res for res, k in RESOURCES.values() if k == kind)
        data = self._get(f"/api/{resource}/{shiki_id}")
        names = [(g.get("russian") or g.get("name") or "").lower() for g in data.get("genres", [])]
        return replace(candidate, genres=[name for name in names if name])

    # --- разбор ответа ---

    @staticmethod
    def _year(date: Optional[str]) -> Optional[int]:
        if date and date[:4].isdigit():
            return int(date[:4])
        return None

    def _poster(self, image: Optional[dict]) -> Optional[str]:
        path = (image or {}).get("original")
        if not path or "missing_" in path:  # заглушка «нет картинки»
            return None
        return urljoin(self.base_url + "/", path)  # пути в ответе относительные

    def _to_candidate(self, kind: str, result: dict) -> Candidate:
        return Candidate(
            source=self.source,
            external_id=f"{kind}:{result['id']}",
            title=result.get("russian") or result.get("name") or "",
            original_title=result.get("name") or None,
            year=self._year(result.get("aired_on")),
            poster_url=self._poster(result.get("image")),
        )
