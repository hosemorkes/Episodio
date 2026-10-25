"""Поиск по внешним каталогам (TMDB, Shikimori, Open Library) для добавления найденного в библиотеку."""
import time
from types import SimpleNamespace
from typing import Callable, Optional

from backend.enrich.base import Candidate, ProviderError
from backend.schemas import CatalogResult

# Категории, по которым ищем, когда категория не указана. tv_series, tv_show и cartoon у TMDB дают один и тот же
# поиск по сериалам, поэтому из них берём только tv_series
DEFAULT_CATEGORIES = ("anime", "tv_series", "movie", "manga", "book")

# Популярное меняется медленно, а на полки уходит несколько запросов к внешним API: ответы держим час
POPULAR_TTL = 3600.0
_popular_cache: dict[tuple[str, int], tuple[float, list[Candidate]]] = {}


def clear_popular_cache() -> None:
    _popular_cache.clear()


def to_result(candidate: Candidate, category: str) -> CatalogResult:
    return CatalogResult(
        source=candidate.source,
        external_id=candidate.external_id,
        category=category,
        title=candidate.title,
        original_title=candidate.original_title,
        year=candidate.year,
        poster_url=candidate.poster_url,
        genres=candidate.genres,
        country=candidate.country,
        author=candidate.author,
        rating=candidate.rating,
    )


def _collect(
    enricher,
    categories: tuple[str, ...],
    limit: int,
    errors_to_catch: tuple,
    describe: Callable[[Exception], str],
    fetch: Callable[[object, str], list[Candidate]],
) -> tuple[list[CatalogResult], list[str], Optional[Exception]]:
    """Опрашивает провайдеров указанных категорий через fetch(provider, category).

    Возвращает (результаты, тексты ошибок, первая ошибка — только если не ответила ни одна категория).
    Источник, у которого нет настроек или который не ответил, пропускается: остальные результаты сохраняются.
    """
    results: list[CatalogResult] = []
    errors: list[str] = []
    seen = set()
    answered = 0
    first_error: Optional[Exception] = None

    for category in categories:
        try:
            candidates = fetch(enricher.provider_for(category), category)
        except errors_to_catch as e:
            first_error = first_error or e
            message = describe(e)
            if message not in errors:
                errors.append(message)
            continue
        answered += 1
        for candidate in candidates[:limit]:
            key = (candidate.source, candidate.external_id, category)
            if key not in seen:
                seen.add(key)
                results.append(to_result(candidate, category))

    return results, errors, (first_error if answered == 0 else None)


def search_catalog(
    enricher,
    query: str,
    categories: tuple[str, ...],
    limit: int,
    errors_to_catch: tuple,
    describe: Callable[[Exception], str],
) -> tuple[list[CatalogResult], list[str], Optional[Exception]]:
    """Ищет строку по провайдерам указанных категорий (см. _collect)."""

    def fetch(provider, category):
        # Провайдеры ищут по полям карточки: строка запроса подставляется как оригинальное и русское название
        probe = SimpleNamespace(
            title_original=query, title_ru=query, release_year=None, category=category, author=None
        )
        return provider.search(probe)

    return _collect(enricher, categories, limit, errors_to_catch, describe, fetch)


def popular_catalog(
    enricher,
    categories: tuple[str, ...],
    limit: int,
    errors_to_catch: tuple,
    describe: Callable[[Exception], str],
    clock: Callable[[], float] = time.monotonic,
) -> tuple[list[CatalogResult], list[str], Optional[Exception]]:
    """Популярное по категориям: у каждого провайдера метод popular(category, limit), ответы кэшируются на час.

    Провайдер без popular даёт ошибку этой категории (остальные категории при этом отвечают).
    """

    def fetch(provider, category):
        key = (category, limit)
        cached = _popular_cache.get(key)
        if cached and clock() < cached[0]:
            return cached[1]
        popular = getattr(provider, "popular", None)
        if popular is None:
            raise ProviderError(f"Для категории «{category}» популярное недоступно")
        candidates = popular(category, limit)
        _popular_cache[key] = (clock() + POPULAR_TTL, candidates)  # ошибки в кэш не попадают
        return candidates

    return _collect(enricher, categories, limit, errors_to_catch, describe, fetch)
