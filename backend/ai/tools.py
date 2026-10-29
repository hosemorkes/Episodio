"""Инструменты «Эпи»: только чтение. К базе — исключительно SELECT в сессии get_readonly_db, остальное — внешние API."""
import asyncio
import json
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from sqlalchemy import any_, func, literal, or_, select
from sqlalchemy.orm import Session

from backend import catalog, stats
from backend.ai import tavily
from backend.database import get_readonly_db
from backend.enrich.base import ProviderError
from backend.models import MediaItem

CATEGORIES = ["anime", "cartoon", "tv_series", "movie", "tv_show", "manga", "book", "audiobook"]
STATUSES = ["watching", "completed", "planned", "dropped"]

MAX_LIBRARY_LIMIT = 25
CATALOG_LIMIT = 10
COMMENT_LIMIT = 300
# Ответ инструмента попадает в контекст модели: слишком длинный обрезаем
MAX_RESULT_CHARS = 8000

# Описание инструментов в формате function calling (OpenAI-совместимом, как у DeepSeek)
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_library",
            "description": (
                "Поиск по личной библиотеке пользователя (только чтение). Возвращает записи с оценкой, статусом и прогрессом. "
                "Для любимых тайтлов используй min_rating=9."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Часть названия (русского или оригинального), автора или жанра"},
                    "category": {"type": "string", "enum": CATEGORIES, "description": "Категория"},
                    "status": {"type": "string", "enum": STATUSES, "description": "Статус: смотрю/читаю, завершено, в планах, брошено"},
                    "min_rating": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Минимальная оценка пользователя"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIBRARY_LIMIT, "description": "Сколько записей вернуть, по умолчанию 10"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_stats",
            "description": "Статистика библиотеки: любимые жанры и страны, распределение по категориям и статусам, топ по прогрессу, суммарный прогресс.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_internet_tavily",
            "description": "Поиск свежей информации в интернете: новости, даты релизов, обзоры, факты, которых нет в библиотеке.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Поисковый запрос"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_catalog_popular",
            "description": "Популярное сейчас во внешних каталогах (TMDB, Shikimori, Open Library) для выбора, что порекомендовать.",
            "parameters": {
                "type": "object",
                "properties": {"category": {"type": "string", "enum": CATEGORIES, "description": "Категория каталога"}},
                "required": ["category"],
            },
        },
    },
]

TOOL_NAMES = {schema["function"]["name"] for schema in TOOL_SCHEMAS}


@dataclass
class ToolContext:
    """Всё, что нужно инструментам: провайдеры каталогов и HTTP-клиент для веб-поиска."""
    enricher: Any = None
    http: Optional[httpx.AsyncClient] = None


def _clip(text: Optional[str], limit: int) -> Optional[str]:
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _like(needle: str) -> str:
    """Шаблон для ILIKE '%…%': спецсимволы пользователя (% _ \\) экранируются обратной косой чертой."""
    for ch in ("\\", "%", "_"):
        needle = needle.replace(ch, "\\" + ch)
    return f"%{needle}%"


def search_library(
    db: Session,
    query: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    min_rating: Optional[int] = None,
    limit: int = 10,
) -> dict:
    """Поиск по media_items (только SELECT). Лучшие по оценке первыми, затем свежие."""
    if category is not None and category not in CATEGORIES:
        return {"error": f"Неизвестная категория «{category}»", "allowed": CATEGORIES}
    if status is not None and status not in STATUSES:
        return {"error": f"Неизвестный статус «{status}»", "allowed": STATUSES}
    limit = max(1, min(int(limit or 10), MAX_LIBRARY_LIMIT))

    stmt = select(MediaItem)
    if query and query.strip():
        needle = query.strip().lower()
        like = _like(needle)
        stmt = stmt.where(
            or_(
                MediaItem.title_ru.ilike(like, escape="\\"),
                MediaItem.title_original.ilike(like, escape="\\"),
                MediaItem.author.ilike(like, escape="\\"),
                literal(needle) == any_(MediaItem.genres),  # жанры хранятся в нижнем регистре
            )
        )
    if category:
        stmt = stmt.where(MediaItem.category == category)
    if status:
        stmt = stmt.where(MediaItem.status == status)
    if min_rating is not None:
        stmt = stmt.where(MediaItem.rating >= max(1, min(int(min_rating), 10)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(MediaItem.rating.desc().nulls_last(), MediaItem.updated_at.desc()).limit(limit)).all()
    return {
        "total_found": total,
        "items": [
            {
                "id": r.id,
                "title": r.title_ru,
                "original_title": r.title_original,
                "category": r.category,
                "status": r.status,
                "rating": r.rating,
                "year": r.release_year,
                "genres": list(r.genres or []),
                "author": r.author,
                "progress": {
                    "season": r.current_season,
                    "episode": r.current_episode,
                    "total_episodes": r.total_episodes,
                    "volume": r.current_volume,
                    "chapter": r.current_chapter,
                    "total_chapters": r.total_chapters,
                },
                "comment": _clip(r.comment, COMMENT_LIMIT),
            }
            for r in rows
        ],
    }


def get_user_stats(db: Session) -> dict:
    """Статистика вкусов: готовые агрегаты backend.stats (график активности и годы модели не нужны)."""
    data = stats.build_stats(db, limit=10)
    keep = ("total_items", "genres", "countries", "categories", "statuses", "top_items", "totals")
    return {key: data[key] for key in keep}


async def search_internet_tavily(query: str, client: Optional[httpx.AsyncClient] = None) -> dict:
    return await tavily.search(query, client)


def get_catalog_popular(enricher: Any, category: str) -> dict:
    """Популярное во внешних каталогах (кэшируется на час); синхронная функция, вызывать из потока."""
    if category not in CATEGORIES:
        return {"error": f"Неизвестная категория «{category}»", "allowed": CATEGORIES}
    results, errors, failure = catalog.popular_catalog(
        enricher,
        (category,),
        CATALOG_LIMIT,
        errors_to_catch=(ProviderError, httpx.HTTPError, ValueError, KeyError),
        describe=str,
    )
    if failure is not None:
        return {"error": errors[0] if errors else "Каталог недоступен"}
    return {
        "category": category,
        "items": [
            {
                "title": r.title,
                "original_title": r.original_title,
                "year": r.year,
                "genres": r.genres,
                "rating": r.rating,
                "source": r.source,
            }
            for r in results
        ],
    }


def _dump(result: dict) -> str:
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = json.dumps({"truncated": True, "partial": text[:MAX_RESULT_CHARS]}, ensure_ascii=False)
    return text


def _library(arguments: dict) -> dict:
    with get_readonly_db() as db:
        return search_library(
            db,
            query=arguments.get("query"),
            category=arguments.get("category"),
            status=arguments.get("status"),
            min_rating=arguments.get("min_rating"),
            limit=arguments.get("limit", 10),
        )


def _stats() -> dict:
    with get_readonly_db() as db:
        return get_user_stats(db)


async def execute_tool(name: str, raw_arguments: str, ctx: ToolContext) -> str:
    """Выполняет инструмент по имени и JSON-аргументам модели; возвращает JSON-строку для сообщения роли tool.

    Любая ошибка превращается в {"error": ...}: модель продолжит разговор, не роняя поток.
    """
    if name not in TOOL_NAMES:
        return _dump({"error": f"Неизвестный инструмент «{name}»"})
    try:
        arguments = json.loads(raw_arguments) if raw_arguments and raw_arguments.strip() else {}
        if not isinstance(arguments, dict):
            raise ValueError("аргументы должны быть объектом JSON")
    except ValueError:
        return _dump({"error": "Некорректные аргументы инструмента"})

    try:
        if name == "search_library":
            result = await asyncio.to_thread(_library, arguments)
        elif name == "get_user_stats":
            result = await asyncio.to_thread(_stats)
        elif name == "search_internet_tavily":
            query = str(arguments.get("query") or "").strip()
            result = await search_internet_tavily(query, ctx.http) if query else {"error": "Пустой запрос"}
        else:
            result = await asyncio.to_thread(get_catalog_popular, ctx.enricher, str(arguments.get("category") or ""))
    except tavily.TavilyConfigError as e:
        result = {"error": str(e)}
    except httpx.TimeoutException:
        result = {"error": "Внешний сервис не ответил вовремя"}
    except httpx.HTTPError as e:
        result = {"error": f"Внешний сервис недоступен: {e.__class__.__name__}"}
    except Exception as e:  # noqa: BLE001 — сбой инструмента не должен обрывать диалог
        result = {"error": f"Инструмент не сработал: {e.__class__.__name__}"}
    return _dump(result)
