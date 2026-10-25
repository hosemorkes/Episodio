"""Общая часть обогащения карточек: кандидат из внешнего API, выбор совпадения и заполнение пустых полей."""
import re
from dataclasses import dataclass, field
from typing import Optional, Protocol

from backend.schemas import normalize_genres


@dataclass
class Candidate:
    """Вариант карточки, найденный во внешнем API."""
    source: str  # например, "tmdb"
    external_id: str
    title: str
    original_title: Optional[str] = None
    year: Optional[int] = None
    poster_url: Optional[str] = None
    genres: list[str] = field(default_factory=list)
    country: Optional[str] = None
    author: Optional[str] = None


class ProviderError(RuntimeError):
    """Ошибка провайдера (нет ключа, неверные настройки...). Текст можно показывать пользователю."""


class ProviderAuthError(ProviderError):
    """Провайдер отказал в доступе: продолжать бессмысленно."""


class ProviderConfigError(ProviderError):
    """Провайдер не настроен (нет ключа, User-Agent...)."""


class UnsupportedCategoryError(ProviderError):
    """Для категории нет подходящего провайдера."""


class Provider(Protocol):
    """Источник данных (TMDB, Shikimori, Open Library...).

    Необязательный метод fill_details(candidate) -> Candidate дополняет единственного выбранного кандидата
    данными, которых нет в результатах поиска (например, жанрами). Он вызывается только после выбора
    совпадения, поэтому не умножает число запросов на каждого кандидата.
    """

    source: str
    categories: frozenset[str]  # какие category умеет искать
    image_hosts: tuple[str, ...]  # с каких хостов скачиваются постеры (для общего лимита запросов)
    fetcher: object  # HttpFetcher провайдера

    def search(self, item) -> list[Candidate]: ...


_PUNCTUATION = re.compile(r"[^\w\s]|_")


def normalize_title(title: Optional[str]) -> str:
    """Нижний регистр, ё -> е, без пунктуации и лишних пробелов."""
    if not title:
        return ""
    text = title.casefold().replace("ё", "е")
    text = re.sub(r"['’`]", "", text)  # апострофы убираем: «Howl's» -> «howls»
    text = _PUNCTUATION.sub(" ", text)
    return " ".join(text.split())


def compact_title(title: Optional[str]) -> str:
    """Нормализованное название без пробелов: «Quan zhi gao shou» и «Quanzhi Gaoshou» (ромадзи) совпадают."""
    return normalize_title(title).replace(" ", "")


def search_queries(item) -> list[str]:
    """Строки для поиска по очереди: сначала оригинальное название, потом русское (без повторов)."""
    queries = []
    for title in (item.title_original, item.title_ru):
        title = (title or "").strip()
        if title and title not in queries:
            queries.append(title)
    return queries


def find_matches(item, candidates: list[Candidate]) -> list[Candidate]:
    """Кандидаты, уверенно совпадающие с карточкой.

    Название (без регистра, пунктуации и пробелов) сравнивается с title_original, а если его нет — с title_ru (кандидата берём и по
    переводному, и по оригинальному названию). Если год известен с обеих сторон, он должен совпадать ±1.
    Один и тот же кандидат, пришедший дважды, считается один раз.
    """
    reference = compact_title(item.title_original) or compact_title(item.title_ru)
    if not reference:
        return []

    seen = set()
    matches = []
    for candidate in candidates:
        key = (candidate.source, candidate.external_id)
        if key in seen:
            continue
        seen.add(key)

        names = {compact_title(candidate.title), compact_title(candidate.original_title)}
        if reference not in names:
            continue
        if item.release_year is not None and candidate.year is not None:
            if abs(item.release_year - candidate.year) > 1:
                continue
        matches.append(candidate)
    return matches


def pick_match(item, candidates: list[Candidate]) -> Optional[Candidate]:
    """Единственный уверенный кандидат. Ни одного или несколько (неоднозначно) -> None."""
    matches = find_matches(item, candidates)
    return matches[0] if len(matches) == 1 else None


def is_empty(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple)):
        return not value
    return False


def apply_candidate(item, candidate: Candidate, poster_url: Optional[str] = None) -> list[str]:
    """Заполняет ТОЛЬКО пустые поля карточки и возвращает названия заполненных полей.

    Заполненное (в том числе вручную) не перезаписывается. poster_url — путь к уже сохранённому
    локальному постеру; если не передан, берётся ссылка кандидата.
    """
    values = {
        "poster_url": poster_url or candidate.poster_url,
        "genres": normalize_genres(candidate.genres),
        "country": candidate.country,
        "release_year": candidate.year,
        "author": candidate.author,
    }
    changed = []
    for name, value in values.items():
        if is_empty(value) or not is_empty(getattr(item, name)):
            continue
        setattr(item, name, value)
        changed.append(name)
    return changed
