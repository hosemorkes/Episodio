from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal[
    "anime", "cartoon", "tv_series", "movie",
    "tv_show", "manga", "book", "audiobook",
]
Status = Literal["watching", "completed", "planned", "dropped"]


def normalize_genres(genres: Optional[list[str]]) -> Optional[list[str]]:
    """Жанры хранятся в нижнем регистре, без пустых значений и повторов; порядок сохраняется."""
    if genres is None:
        return None
    result: list[str] = []
    for genre in genres:
        genre = genre.strip().lower()
        if genre and genre not in result:
            result.append(genre)
    return result


class GenresNormalizerMixin(BaseModel):
    @field_validator("genres", check_fields=False)
    @classmethod
    def lower_genres(cls, genres):
        return normalize_genres(genres)


class MediaItemBase(GenresNormalizerMixin):
    title_ru: str = Field(min_length=1, max_length=255)
    title_original: Optional[str] = Field(None, max_length=255)
    category: Category
    genres: list[str] = []
    author: Optional[str] = Field(None, max_length=255)
    country: Optional[str] = Field(None, max_length=100)
    release_year: Optional[int] = None
    description: Optional[str] = None

    status: Status = "planned"

    current_season: Optional[int] = Field(None, ge=0)
    current_episode: Optional[int] = Field(None, ge=0)
    current_volume: Optional[int] = Field(None, ge=0)
    current_chapter: Optional[int] = Field(None, ge=0)

    total_episodes: Optional[int] = Field(None, ge=0)
    total_chapters: Optional[int] = Field(None, ge=0)

    translation: Optional[str] = Field(None, max_length=255)

    rating: Optional[int] = Field(None, ge=1, le=10)
    comment: Optional[str] = None

    poster_url: Optional[str] = None
    source_link: Optional[str] = None

    raw: Optional[str] = None


class MediaItemCreate(MediaItemBase):
    pass


class MediaItemUpdate(GenresNormalizerMixin):
    """Частичное обновление: передаются только изменённые поля."""
    title_ru: Optional[str] = Field(None, min_length=1, max_length=255)
    title_original: Optional[str] = Field(None, max_length=255)
    category: Optional[Category] = None
    genres: Optional[list[str]] = None
    author: Optional[str] = Field(None, max_length=255)
    country: Optional[str] = Field(None, max_length=100)
    release_year: Optional[int] = None
    description: Optional[str] = None

    status: Optional[Status] = None

    current_season: Optional[int] = Field(None, ge=0)
    current_episode: Optional[int] = Field(None, ge=0)
    current_volume: Optional[int] = Field(None, ge=0)
    current_chapter: Optional[int] = Field(None, ge=0)

    total_episodes: Optional[int] = Field(None, ge=0)
    total_chapters: Optional[int] = Field(None, ge=0)

    translation: Optional[str] = Field(None, max_length=255)

    rating: Optional[int] = Field(None, ge=1, le=10)
    comment: Optional[str] = None

    poster_url: Optional[str] = None
    source_link: Optional[str] = None


class MediaItemResponse(MediaItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    finished_at: Optional[datetime] = None  # ставит триггер БД, изменить через API нельзя
    created_at: datetime
    updated_at: datetime


class ProgressRequest(BaseModel):
    delta: Literal[1, -1]


class LogEntryResponse(BaseModel):
    """Запись ленты активности вместе с данными тайтла."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    title_ru: str
    title_original: Optional[str] = None
    category: Category
    unit: Literal["episode", "chapter", "movie"]
    number: int
    logged_at: datetime


class ProgressResponse(BaseModel):
    item: MediaItemResponse
    # +1: созданная запись журнала; −1: удалённая (None, если журнал был пуст)
    entry: Optional[LogEntryResponse] = None


class StatsCount(BaseModel):
    """Строка распределения: сколько записей и сколько единиц прогресса (серий, глав, просмотренных фильмов)."""
    name: str
    items: int
    progress: int


class StatsYear(BaseModel):
    year: int
    items: int
    progress: int


class StatsTopItem(BaseModel):
    item_id: int
    title_ru: str
    title_original: Optional[str] = None
    category: Category
    progress: int


class StatsDay(BaseModel):
    date: date
    count: int


class StatsMarks(BaseModel):
    """Серии, главы и фильмы раздельно: их нельзя складывать в одно число."""
    episodes: int
    chapters: int
    movies: int


class StatsResponse(BaseModel):
    period_from: date
    period_to: date
    total_items: int
    # Распределения по всей библиотеке; progress — единицы прогресса записей (серии, главы, фильм = 1)
    genres: list[StatsCount]
    countries: list[StatsCount]
    categories: list[StatsCount]
    statuses: list[StatsCount]
    years: list[StatsYear]
    top_items: list[StatsTopItem]
    # Накоплено по библиотеке (по счётчикам записей, не по журналу)
    totals: StatsMarks
    # Журнал за период: отметки по дням (каждый день периода, пустые = 0) и их сумма по видам
    activity: list[StatsDay]
    marks: StatsMarks


class CatalogResult(BaseModel):
    """Найденный во внешнем каталоге тайтл (ещё не в библиотеке)."""
    source: str
    external_id: str
    category: Category  # в какой категории искали: от неё зависит источник
    title: str
    original_title: Optional[str] = None
    year: Optional[int] = None
    poster_url: Optional[str] = None
    genres: list[str] = []
    country: Optional[str] = None
    author: Optional[str] = None
    rating: Optional[float] = None  # оценка источника по 10-балльной шкале (есть не у всех)


class CatalogSearchResponse(BaseModel):
    results: list[CatalogResult]
    # Источники, которые не ответили или не настроены; остальные результаты при этом возвращаются
    errors: list[str] = []


class CatalogAddRequest(GenresNormalizerMixin):
    """Добавление найденного в каталоге тайтла в библиотеку: поля берутся из результата поиска."""
    source: str = Field(min_length=1)
    external_id: str = Field(min_length=1)
    category: Category
    status: Status = "planned"
    title: str = Field(min_length=1, max_length=255)
    original_title: Optional[str] = Field(None, max_length=255)
    year: Optional[int] = None
    poster_url: Optional[str] = None
    genres: list[str] = []
    country: Optional[str] = Field(None, max_length=100)
    author: Optional[str] = Field(None, max_length=255)


class EnrichCandidate(BaseModel):
    """Вариант карточки, найденный во внешнем API (для ручного выбора)."""
    source: str
    external_id: str
    title: str
    original_title: Optional[str] = None
    year: Optional[int] = None
    poster_url: Optional[str] = None
    genres: list[str] = []
    country: Optional[str] = None
    author: Optional[str] = None


class EnrichApplyRequest(BaseModel):
    source: str = Field(min_length=1)
    external_id: str = Field(min_length=1)


class EnrichApplyResponse(BaseModel):
    item: MediaItemResponse
    changed: list[str]  # какие поля были заполнены
