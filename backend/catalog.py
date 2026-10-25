"""Поиск по внешним каталогам (TMDB, Shikimori, Open Library) для добавления найденного в библиотеку."""
from types import SimpleNamespace
from typing import Callable, Optional

from backend.enrich.base import Candidate
from backend.schemas import CatalogResult

# Категории, по которым ищем, когда категория не указана. tv_series, tv_show и cartoon у TMDB дают один и тот же
# поиск по сериалам, поэтому из них берём только tv_series
DEFAULT_CATEGORIES = ("anime", "tv_series", "movie", "manga", "book")


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
    )


def search_catalog(
    enricher,
    query: str,
    categories: tuple[str, ...],
    limit: int,
    errors_to_catch: tuple,
    describe: Callable[[Exception], str],
) -> tuple[list[CatalogResult], list[str], Optional[Exception]]:
    """Ищет строку по провайдерам указанных категорий.

    Возвращает (результаты, тексты ошибок, первая ошибка — только если не ответила ни одна категория).
    Источник, у которого нет настроек или который не ответил, пропускается: остальные результаты сохраняются.
    """
    results: list[CatalogResult] = []
    errors: list[str] = []
    seen = set()
    answered = 0
    first_error: Optional[Exception] = None

    for category in categories:
        # Провайдеры ищут по полям карточки: строка запроса подставляется как оригинальное и русское название
        probe = SimpleNamespace(
            title_original=query, title_ru=query, release_year=None, category=category, author=None
        )
        try:
            candidates = enricher.provider_for(category).search(probe)
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
