"""Веб-поиск через Tavily (https://docs.tavily.com): асинхронный клиент на httpx и разбор ответа."""
import os
from typing import Optional

import httpx

TAVILY_URL = "https://api.tavily.com/search"
TIMEOUT = 20.0
MAX_RESULTS = 5
SNIPPET_LIMIT = 500


class TavilyConfigError(Exception):
    """Не задан TAVILY_API_KEY."""


def parse_response(data: dict, max_results: int = MAX_RESULTS) -> dict:
    """Сжимает ответ Tavily до того, что нужно модели: краткий ответ и список источников (заголовок, ссылка, фрагмент)."""
    results = []
    for r in (data.get("results") or [])[:max_results]:
        if not isinstance(r, dict) or not r.get("url"):
            continue
        results.append(
            {
                "title": str(r.get("title") or "").strip(),
                "url": r["url"],
                "content": str(r.get("content") or "").strip()[:SNIPPET_LIMIT],
            }
        )
    return {"answer": data.get("answer") or None, "results": results}


async def search(query: str, client: Optional[httpx.AsyncClient] = None, api_key: Optional[str] = None) -> dict:
    """Ищет в интернете. Ошибки сети и статусы 4xx/5xx поднимаются как httpx.HTTPError."""
    api_key = api_key or os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        raise TavilyConfigError("Веб-поиск не настроен: задайте TAVILY_API_KEY в .env")

    payload = {"query": query, "max_results": MAX_RESULTS, "include_answer": True, "search_depth": "basic"}
    headers = {"Authorization": f"Bearer {api_key}"}
    if client is None:
        async with httpx.AsyncClient(timeout=TIMEOUT) as own:
            response = await own.post(TAVILY_URL, json=payload, headers=headers)
    else:
        response = await client.post(TAVILY_URL, json=payload, headers=headers)
    response.raise_for_status()
    return parse_response(response.json())
