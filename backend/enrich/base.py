"""Общая часть обогащения карточек: кандидат из внешнего API, выбор совпадения и заполнение пустых полей."""
import re
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

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
    description: Optional[str] = None  # краткое описание на русском (другие языки отбрасывает clean_description); поиск отдаёт его не у всех источников, остальным его подгружает fill_details
    rating: Optional[float] = None  # оценка источника по 10-балльной шкале, если он её отдаёт
    total_episodes: Optional[int] = None  # заполняет fill_details, если источник знает общее число серий
    total_chapters: Optional[int] = None
    # Категория записи, для которой ищут кандидата. Нужна там, где id не определяет тип (у TMDB id фильма и сериала
    # пересекаются); поиск её не заполняет, её передаёт код добавления из каталога
    category: Optional[str] = None


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
    данными, которых нет в результатах поиска (например, жанрами и общим числом серий или глав). Он вызывается
    только после выбора совпадения, поэтому не умножает число запросов на каждого кандидата.

    Необязательный метод popular(category, limit) -> list[Candidate] возвращает популярное по категории
    (для полок каталога).
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


_YEAR_SUFFIX = re.compile(r"\s*\(\d{4}\)\s*$")


def compact_title(title: Optional[str]) -> str:
    """Нормализованное название без пробелов: «Quan zhi gao shou» и «Quanzhi Gaoshou» (ромадзи) совпадают.

    Год в скобках в конце отбрасывается: каталоги различают одноимённые сериалы так («The Flash (2014)»).
    """
    return normalize_title(_YEAR_SUFFIX.sub("", title or "")).replace(" ", "")


def search_queries(item) -> list[str]:
    """Строки для поиска по очереди: сначала русское название, потом оригинальное (английское или ромадзи), без повторов."""
    queries = []
    for title in (item.title_ru, item.title_original):
        title = (title or "").strip()
        if title and title not in queries:
            queries.append(title)
    return queries


def find_matches(item, candidates: list[Candidate]) -> list[Candidate]:
    """Кандидаты, уверенно совпадающие с карточкой.

    Сначала карточка сравнивается по русскому названию (title_ru), потом по оригинальному, английскому или ромадзи
    (title_original); название сравнивается без регистра, пунктуации и пробелов с переводным и оригинальным названием
    кандидата. Берётся первое сравнение с единственным совпадением; если такого нет, то первое с несколькими
    (неоднозначно). Синонимы и другие названия источника не используются: ошибочное совпадение хуже ненайденного,
    остальное подбирается вручную («Найти данные»). Если год известен с обеих сторон, он должен совпадать ±1.
    Один и тот же кандидат, пришедший дважды, считается один раз.
    """
    unique = []
    seen = set()
    for candidate in candidates:
        key = (candidate.source, candidate.external_id)
        if key not in seen:
            seen.add(key)
            unique.append(candidate)

    ambiguous: list[Candidate] = []
    for title in (item.title_ru, item.title_original):
        reference = compact_title(title)
        if not reference:
            continue
        matches = []
        for candidate in unique:
            if reference not in {compact_title(candidate.title), compact_title(candidate.original_title)}:
                continue
            if item.release_year is not None and candidate.year is not None:
                if abs(item.release_year - candidate.year) > 1:
                    continue
            matches.append(candidate)
        if len(matches) == 1:
            return matches
        ambiguous = ambiguous or matches
    return ambiguous


def search_by_titles(item, fetch: Callable[[str], list[Candidate]]) -> list[Candidate]:
    """Ищет по русскому названию, затем по оригинальному (английскому или ромадзи): fetch(строка) -> кандидаты.

    Поиск идёт дальше, пока среди найденного нет совпадения с карточкой (find_matches). Если совпадения нет нигде,
    возвращаются все найденные кандидаты без повторов: из них можно выбрать вручную.
    """
    found: list[Candidate] = []
    for query in search_queries(item):
        results = fetch(query)
        if find_matches(item, results):
            return results
        known = {(c.source, c.external_id) for c in found}
        found.extend(c for c in results if (c.source, c.external_id) not in known)
    return found


def pick_match(item, candidates: list[Candidate]) -> Optional[Candidate]:
    """Единственный уверенный кандидат. Ни одного или несколько (неоднозначно) -> None."""
    matches = find_matches(item, candidates)
    return matches[0] if len(matches) == 1 else None


DESCRIPTION_LIMIT = 2000
_BBCODE = re.compile(r"\[/?[A-Za-z_]+(?:=[^\]]*)?\]")
_WIKI_LINK = re.compile(r"\[\[(.*?)\]\]")
_HTML_BREAK = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_LETTER = re.compile(r"[^\W\d_]")


def clean_description(text: Optional[str], limit: int = DESCRIPTION_LIMIT) -> Optional[str]:
    """Русское описание без BBCode Shikimori ([character=1]…[/character]) и HTML; абзацы сохраняются, длина ограничена.

    Текст не на русском (нет перевода у источника) отбрасывается: вернётся None, и поле останется пустым.
    """
    if not text:
        return None
    text = _HTML_BREAK.sub("\n", text)
    text = _WIKI_LINK.sub(r"\1", text)
    text = _BBCODE.sub("", text)
    text = _HTML_TAG.sub("", text)
    paragraphs = [" ".join(line.split()) for line in text.splitlines()]
    text = "\n".join(p for p in paragraphs if p).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    if not text or not is_russian(text):
        return None
    return text


def is_russian(text: str) -> bool:
    """Больше половины букв — кириллица: описания на английском и других языках в базу не попадают."""
    letters = len(_LETTER.findall(text))
    return letters > 0 and len(_CYRILLIC.findall(text)) / letters > 0.5


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
        "description": candidate.description,
    }
    changed = []
    for name, value in values.items():
        if is_empty(value) or not is_empty(getattr(item, name)):
            continue
        setattr(item, name, value)
        changed.append(name)
    return changed
