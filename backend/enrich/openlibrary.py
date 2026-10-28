"""Клиент Open Library (https://openlibrary.org/dev/docs/api/search): поиск книг и аудиокниг.

Правила API: запросы подписываются User-Agent с названием приложения и контактом; без контакта лимит
1 запрос в секунду, с контактом — 3. Контакт задаётся в OPENLIBRARY_USER_AGENT (необязательно),
например «Episodio (you@example.com)».

Из результатов берутся автор, год первой публикации и обложка (по cover id, сервис covers.openlibrary.org).
Жанров в поиске нет (поле subject шумное и английское), поэтому жанры не заполняются.
"""
import os
from typing import Optional

from backend.enrich.base import Candidate, search_by_titles
from backend.enrich.client import USER_AGENT, HttpFetcher

SEARCH_URL = "https://openlibrary.org/search.json"
TRENDING_URL = "https://openlibrary.org/trending/weekly.json"
COVER_URL = "https://covers.openlibrary.org/b/id/{cover_id}-L.jpg?default=false"  # без обложки — 404, а не пустая картинка
FIELDS = "key,title,author_name,first_publish_year,cover_i"
RESULTS_LIMIT = 10

INTERVAL_ANONYMOUS = 1.1  # лимит 1 запрос в секунду
INTERVAL_IDENTIFIED = 0.4  # лимит 3 запроса в секунду


class OpenLibraryProvider:
    source = "openlibrary"
    categories = frozenset({"book", "audiobook"})
    image_hosts = ("covers.openlibrary.org",)

    def __init__(self, user_agent: Optional[str] = None, fetcher: Optional[HttpFetcher] = None):
        user_agent = (user_agent or os.getenv("OPENLIBRARY_USER_AGENT") or "").strip()
        self.fetcher = fetcher or HttpFetcher(
            user_agent=user_agent or USER_AGENT,
            min_interval=INTERVAL_IDENTIFIED if user_agent else INTERVAL_ANONYMOUS,
        )

    def _search(self, title: str, author: Optional[str]) -> list[dict]:
        params = {"title": title, "fields": FIELDS, "limit": RESULTS_LIMIT}
        if author:
            params["author"] = author
        return self.fetcher.get(SEARCH_URL, params=params).json().get("docs", [])

    def search(self, item) -> list[Candidate]:
        author = (item.author or "").strip() or None

        def fetch(query: str) -> list[Candidate]:
            docs = self._search(query, author)
            if not docs and author:
                # Автор в нашем списке мог быть записан иначе (по-русски): ищем только по названию
                docs = self._search(query, None)
            return [self._to_candidate(doc) for doc in docs]

        return search_by_titles(item, fetch)

    def popular(self, category: str, limit: int) -> list[Candidate]:
        """Книги, которые читают на этой неделе (общий список: аудиокниги отдельно Open Library не выделяет)."""
        docs = self.fetcher.get(TRENDING_URL, params={"limit": limit}).json().get("works", [])
        return [self._to_candidate(doc) for doc in docs[:limit] if doc.get("key") and doc.get("title")]

    @staticmethod
    def _to_candidate(doc: dict) -> Candidate:
        authors = doc.get("author_name") or []
        cover_id = doc.get("cover_i")
        return Candidate(
            source="openlibrary",
            external_id=doc["key"],
            title=doc.get("title") or "",
            original_title=None,  # Open Library хранит одно название
            year=doc.get("first_publish_year"),
            poster_url=COVER_URL.format(cover_id=cover_id) if cover_id else None,
            author=authors[0] if authors else None,
        )
