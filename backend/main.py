import os
import secrets
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from datetime import date
from typing import Literal, Optional

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Security, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import APIKeyHeader
from fastapi.staticfiles import StaticFiles
from sqlalchemy import any_, func, literal, or_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend import catalog, exporter, posters, progress, showcase, stats
from backend.ai import conversations as ai_conversations
from backend.ai.agent import AgentConfigError, DeepSeekSettings, run_agent
from backend.ai.tools import ToolContext
from backend.database import SessionLocal, get_db
from backend.enrich.base import (
    Candidate,
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    UnsupportedCategoryError,
    apply_candidate,
    is_empty,
)
from backend.enrich.registry import Enricher
from backend.models import AiConversation, MediaItem, ProgressLog
from backend.schemas import (
    AiConversationCreate,
    AiConversationResponse,
    AiMessageCreate,
    AiMessageResponse,
    CatalogAddRequest,
    CatalogSearchResponse,
    Category,
    EnrichApplyRequest,
    EnrichApplyResponse,
    EnrichCandidate,
    LogEntryResponse,
    MediaItemCreate,
    MediaItemResponse,
    MediaItemUpdate,
    ProgressRequest,
    ProgressResponse,
    Status,
    StatsResponse,
    normalize_genres,
)

# Поля, которые в базе NOT NULL: явно передать для них null в PATCH нельзя
REQUIRED_FIELDS = {"title_ru", "category", "status"}

# Провайдеры обогащения общие для всех запросов (кэш жанров, лимиты частоты запросов)
default_enricher = Enricher()


def get_enricher() -> Enricher:
    return default_enricher


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    default_enricher.close()


# Защита общим секретом: включается, только если в окружении задан API_KEY.
# Без ключа открыты проверка работы и корень; постеры (/posters) отдаются статикой вне зависимостей
OPEN_PATHS = {"/", "/health"}
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(request: Request, key: Optional[str] = Security(api_key_header)) -> None:
    expected = os.getenv("API_KEY")
    if not expected or request.url.path in OPEN_PATHS:
        return
    if key is None or not secrets.compare_digest(key.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Нужен корректный заголовок X-API-Key")


app = FastAPI(
    title="Episodio API",
    description="Личное хранилище аниме, сериалов, фильмов, манги и книг.",
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(require_api_key)],
)

# Витрины: управление (с ключом API) и публичное чтение
app.include_router(showcase.router)

# Экспорт библиотеки: Excel и JSON
app.include_router(exporter.router)

# Постеры отдаются как статика: /posters/42.jpg -> media/posters/42.jpg (путь считается от корня проекта)
app.mount("/posters", StaticFiles(directory=posters.POSTERS_DIR, check_dir=False), name="posters")


def get_item_or_404(db: Session, item_id: int) -> MediaItem:
    item = db.get(MediaItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Элемент не найден")
    return item


@app.get("/")
def read_root():
    return {"message": "Добро пожаловать в Episodio API! 🎬📚"}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """Проверка работы API и соединения с базой данных."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="База данных недоступна")
    return {"status": "ok"}


# Поля, по которым можно сортировать список; у необязательных пустые значения всегда в конце
SORT_COLUMNS = {
    "updated_at": MediaItem.updated_at,
    "created_at": MediaItem.created_at,
    "finished_at": MediaItem.finished_at,
    "title_ru": MediaItem.title_ru,
    "release_year": MediaItem.release_year,
    "rating": MediaItem.rating,
}


# 1. Список с фильтрами: категория, статус, жанр и поиск по названию; сортировка и постраничный вывод
@app.get("/items/", response_model=list[MediaItemResponse])
def list_items(
    category: Optional[Category] = None,
    item_status: Optional[Status] = Query(None, alias="status"),
    genre: Optional[str] = None,
    q: Optional[str] = Query(None, description="Поиск по русскому или оригинальному названию"),
    sort: Literal["updated_at", "created_at", "finished_at", "title_ru", "release_year", "rating"] = "updated_at",
    order: Literal["asc", "desc"] = "desc",
    limit: Optional[int] = Query(None, ge=1, le=500, description="Сколько записей вернуть (по умолчанию все)"),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(MediaItem)
    if category:
        query = query.filter(MediaItem.category == category)
    if item_status:
        query = query.filter(MediaItem.status == item_status)
    if genre:
        # Жанры в базе хранятся в нижнем регистре
        query = query.filter(literal(genre.strip().lower()) == any_(MediaItem.genres))
    if q:
        # Спецсимволы LIKE экранируем, чтобы «%» и «_» искались как обычные символы
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            or_(
                MediaItem.title_ru.ilike(pattern, escape="\\"),
                MediaItem.title_original.ilike(pattern, escape="\\"),
            )
        )
    column = SORT_COLUMNS[sort]
    ordering = column.desc() if order == "desc" else column.asc()
    # id в конце делает порядок устойчивым, иначе страницы могут пересекаться
    query = query.order_by(ordering.nulls_last(), MediaItem.id.desc()).offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return query.all()


# Жанры, которые есть в базе (для фильтра), в алфавитном порядке
@app.get("/genres", response_model=list[str])
def list_genres(category: Optional[Category] = None, db: Session = Depends(get_db)):
    sql = "SELECT DISTINCT g FROM media_items, unnest(genres) AS g"
    params = {}
    if category:
        sql += " WHERE category = :category"
        params["category"] = category
    rows = db.execute(text(sql + " ORDER BY g"), params)
    return [row[0] for row in rows]


# Лента активности: свежие записи журнала первыми. before — id последней записи прошлой страницы
@app.get("/log", response_model=list[LogEntryResponse])
def list_log(
    limit: int = Query(20, ge=1, le=100),
    before: Optional[int] = Query(None, ge=1, description="Вернуть записи старше этого id (для следующей страницы)"),
    item_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(
        ProgressLog.id,
        ProgressLog.item_id,
        MediaItem.title_ru,
        MediaItem.title_original,
        MediaItem.category,
        ProgressLog.unit,
        ProgressLog.number,
        ProgressLog.logged_at,
    ).join(MediaItem, MediaItem.id == ProgressLog.item_id)
    if before is not None:
        query = query.filter(ProgressLog.id < before)
    if item_id is not None:
        query = query.filter(ProgressLog.item_id == item_id)
    return [row._asdict() for row in query.order_by(ProgressLog.id.desc()).limit(limit)]


# Статистика: распределения по библиотеке и активность журнала за период (по умолчанию последние 7 дней)
@app.get("/stats", response_model=StatsResponse)
def get_stats(
    date_from: Optional[date] = Query(None, alias="from", description="Начало периода, YYYY-MM-DD (включительно)"),
    date_to: Optional[date] = Query(None, alias="to", description="Конец периода, YYYY-MM-DD (включительно, по умолчанию сегодня)"),
    limit: int = Query(10, ge=1, le=50, description="Сколько строк в жанрах, странах и топе"),
    db: Session = Depends(get_db),
):
    try:
        return stats.build_stats(db, date_from, date_to, limit)
    except stats.PeriodError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from e


# 2. Одна запись
@app.get("/items/{item_id}", response_model=MediaItemResponse)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return get_item_or_404(db, item_id)


# 3. Добавить запись
@app.post("/items/", response_model=MediaItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(item: MediaItemCreate, db: Session = Depends(get_db)):
    db_item = MediaItem(**item.model_dump())
    db.add(db_item)
    db.flush()
    progress.sync_movie_log(db, db_item, old_status=None)
    db.commit()
    db.refresh(db_item)
    return db_item


# 4. Частично обновить запись (прогресс, оценку, статус, заметку...)
@app.patch("/items/{item_id}", response_model=MediaItemResponse)
def update_item(item_id: int, item_update: MediaItemUpdate, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    changes = item_update.model_dump(exclude_unset=True)
    nulls = sorted(name for name in REQUIRED_FIELDS if name in changes and changes[name] is None)
    if nulls:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Поля нельзя очистить: {', '.join(nulls)}",
        )
    old_status = db_item.status
    for key, value in changes.items():
        setattr(db_item, key, value)
    progress.sync_movie_log(db, db_item, old_status)
    db.commit()
    db.refresh(db_item)
    return db_item


# 4а. Отметить серию/главу (delta=1) или откатить (delta=-1) с записью в журнал
@app.post("/items/{item_id}/progress", response_model=ProgressResponse)
def change_progress(item_id: int, body: ProgressRequest, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    try:
        entry = progress.apply_delta(db, db_item, body.delta)
    except progress.NothingToMark as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except progress.ProgressError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    # Данные записи берём до коммита: удалённый при откате объект после него уже не читается
    entry_data = None
    if entry is not None:
        entry_data = {
            "id": entry.id,
            "item_id": db_item.id,
            "title_ru": db_item.title_ru,
            "title_original": db_item.title_original,
            "category": db_item.category,
            "unit": entry.unit,
            "number": entry.number,
            "logged_at": entry.logged_at,
        }
    db.commit()
    db.refresh(db_item)
    return {"item": db_item, "entry": entry_data}


# 5. Удалить запись
@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    db.delete(db_item)
    db.commit()
    posters.delete_poster(item_id)
    return None


# 6. Загрузить свой постер (jpeg, png, webp, до 5 МБ)
@app.post("/items/{item_id}/poster", response_model=MediaItemResponse)
async def upload_poster(item_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    # Читаем на один байт больше лимита: так видно превышение, не загружая в память огромный файл целиком
    content = await file.read(posters.MAX_SIZE + 1)
    try:
        db_item.poster_url = posters.save_poster(item_id, content, file.content_type)
    except posters.PosterError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    db.commit()
    db.refresh(db_item)
    return db_item


# 7. Удалить постер: файл и ссылка на него
@app.delete("/items/{item_id}/poster", response_model=MediaItemResponse)
def delete_item_poster(item_id: int, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    posters.delete_poster(item_id)
    db_item.poster_url = None
    db.commit()
    db.refresh(db_item)
    return db_item


# --- Ручной выбор при обогащении из внешних API ---

def enrich_error(error: Exception) -> HTTPException:
    """Ошибка внешнего API -> понятный ответ 502 или 503 вместо 500."""
    if isinstance(error, UnsupportedCategoryError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    if isinstance(error, (ProviderConfigError, ProviderAuthError)):
        # Не настроен или не принял ключ: проблема в настройках, а не во внешнем сервисе
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Обогащение недоступно: {error}"
        )
    if isinstance(error, httpx.TimeoutException):
        detail = "Внешний сервис не ответил вовремя, попробуй позже"
    elif isinstance(error, httpx.HTTPStatusError):
        detail = f"Внешний сервис вернул ошибку {error.response.status_code}"
    elif isinstance(error, httpx.TransportError):
        detail = "Не удалось связаться с внешним сервисом: проверь подключение к интернету"
    elif isinstance(error, ProviderError):
        detail = f"Ошибка внешнего сервиса: {error}"
    else:
        detail = "Внешний сервис вернул неожиданный ответ"
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


# Что может пойти не так при обращении к внешнему API (ValueError и KeyError — неожиданный формат ответа)
EXTERNAL_ERRORS = (ProviderError, httpx.HTTPError, ValueError, KeyError)


# --- Каталог: поиск по внешним источникам и добавление найденного в библиотеку ---

def catalog_categories(enricher: Enricher, category: Optional[str], source: Optional[str]) -> tuple[str, ...]:
    """Категории запроса к каталогу. Без category — основные; с source — только те из них, которые источник обслуживает."""
    if category:
        return (category,)
    if source is None:
        return catalog.DEFAULT_CATEGORIES
    categories = tuple(c for c in catalog.DEFAULT_CATEGORIES if c in enricher.categories_of(source))
    if not categories:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Неизвестный источник «{source}»")
    return categories


# 7а. Поиск по каталогам. Без category ищем по основным (аниме, сериалы, фильмы, манга, книги).
# source выбирает источник вместо источника по умолчанию (у аниме и манги, кроме Shikimori, есть AniList)
@app.get("/catalog/search", response_model=CatalogSearchResponse)
def search_in_catalog(
    q: str = Query(..., min_length=2, max_length=100, description="Название или его часть"),
    category: Optional[Category] = None,
    source: Optional[str] = Query(None, max_length=32, description="Источник: tmdb, tvdb, shikimori, anilist, openlibrary"),
    limit: int = Query(10, ge=1, le=20, description="Сколько результатов брать из каждой категории"),
    enricher: Enricher = Depends(get_enricher),
):
    categories = catalog_categories(enricher, category, source)
    results, errors, failure = catalog.search_catalog(
        enricher,
        q.strip(),
        categories,
        limit,
        errors_to_catch=EXTERNAL_ERRORS,
        describe=lambda e: str(enrich_error(e).detail),
        source=source,
    )
    if failure is not None:
        # Ни один источник не ответил: ошибка внешнего сервиса (502/503), а не пустой список
        raise enrich_error(failure) from failure
    return CatalogSearchResponse(results=results, errors=errors)


# 7а-2. Популярное для полок «Обзора». Без category — по основным категориям; ответы кэшируются на час
@app.get("/catalog/popular", response_model=CatalogSearchResponse)
def popular_in_catalog(
    category: Optional[Category] = None,
    source: Optional[str] = Query(None, max_length=32, description="Источник: tmdb, tvdb, shikimori, anilist, openlibrary"),
    limit: int = Query(12, ge=1, le=30, description="Сколько результатов брать из каждой категории"),
    enricher: Enricher = Depends(get_enricher),
):
    categories = catalog_categories(enricher, category, source)
    results, errors, failure = catalog.popular_catalog(
        enricher,
        categories,
        limit,
        errors_to_catch=EXTERNAL_ERRORS,
        describe=lambda e: str(enrich_error(e).detail),
        source=source,
    )
    if failure is not None:
        raise enrich_error(failure) from failure
    return CatalogSearchResponse(results=results, errors=errors)


# 7б. Добавить найденный тайтл в библиотеку; постер скачивается в media/posters, если источник его отдаёт
@app.post("/items/from-catalog", response_model=MediaItemResponse, status_code=status.HTTP_201_CREATED)
def add_from_catalog(body: CatalogAddRequest, db: Session = Depends(get_db), enricher: Enricher = Depends(get_enricher)):
    try:
        provider = enricher.provider_for(body.category, body.source)
    except ProviderError as e:
        raise enrich_error(e) from e
    if provider.source != body.source:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Источник «{body.source}» не подходит для категории «{body.category}» (нужен «{provider.source}»)",
        )

    title_ru = body.title.strip()
    original = (body.original_title or "").strip() or None
    # Тот же признак дубликата, что и при импорте: названия без учёта регистра и категория
    duplicate = (
        db.query(MediaItem.id)
        .filter(
            MediaItem.category == body.category,
            func.lower(MediaItem.title_ru) == title_ru.lower(),
            func.lower(func.coalesce(MediaItem.title_original, "")) == (original or "").lower(),
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Уже в библиотеке: {title_ru}")

    candidate = Candidate(
        source=body.source, external_id=body.external_id, title=title_ru, original_title=original, year=body.year,
        poster_url=body.poster_url, genres=body.genres, country=body.country, author=body.author,
        category=body.category,
    )
    fill_details = getattr(provider, "fill_details", None)
    if fill_details:
        given_genres = candidate.genres
        try:
            # У Shikimori жанры приходят только с карточкой; у обоих источников там же общее число серий или глав
            detailed = fill_details(candidate)
            candidate = replace(detailed, genres=given_genres or detailed.genres)  # присланные жанры не заменяем
        except EXTERNAL_ERRORS:
            pass  # без жанров и итогов добавить можно, жанры дозаполнит обогащение

    db_item = MediaItem(
        title_ru=candidate.title,
        title_original=candidate.original_title,
        category=body.category,
        genres=normalize_genres(candidate.genres),
        author=candidate.author,
        country=candidate.country,
        release_year=candidate.year,
        description=candidate.description,
        total_episodes=candidate.total_episodes,
        total_chapters=candidate.total_chapters,
        status=body.status,
    )
    db.add(db_item)
    db.flush()
    progress.sync_movie_log(db, db_item, old_status=None)

    if candidate.poster_url:
        try:
            content, content_type = enricher.download(candidate.poster_url)
            db_item.poster_url = posters.save_poster(db_item.id, content, content_type)
        except (ProviderError, httpx.HTTPError, posters.PosterError):
            pass  # тайтл важнее картинки: постер можно загрузить позже

    db.commit()
    db.refresh(db_item)
    return db_item


# 8. Варианты для ручного выбора: ищем у провайдера категории, ничего не сохраняем
@app.get("/items/{item_id}/enrich/candidates", response_model=list[EnrichCandidate])
def enrich_candidates(
    item_id: int,
    source: Optional[str] = Query(None, max_length=32, description="Источник вместо источника по умолчанию (например, anilist)"),
    db: Session = Depends(get_db),
    enricher: Enricher = Depends(get_enricher),
):
    db_item = get_item_or_404(db, item_id)
    try:
        candidates = enricher.provider_for(db_item.category, source).search(db_item)
    except EXTERNAL_ERRORS as e:
        raise enrich_error(e) from e
    return [EnrichCandidate(**asdict(candidate)) for candidate in candidates]


# 9. Применить выбранного кандидата: заполняются только пустые поля, force=true разрешает заменить постер
@app.post("/items/{item_id}/enrich/apply", response_model=EnrichApplyResponse)
def enrich_apply(
    item_id: int,
    body: EnrichApplyRequest,
    force: bool = Query(False, description="Заменить постер, даже если он уже есть (остальные поля не перезаписываются)"),
    db: Session = Depends(get_db),
    enricher: Enricher = Depends(get_enricher),
):
    db_item = get_item_or_404(db, item_id)

    try:
        provider = enricher.provider_for(db_item.category, body.source)
    except ProviderError as e:
        raise enrich_error(e) from e
    if provider.source != body.source:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Источник «{body.source}» не подходит для категории «{db_item.category}» (нужен «{provider.source}»)",
        )

    try:
        # Кандидата получаем повторным поиском: выбирать нужно из того же списка, что отдаёт /enrich/candidates
        candidate = next((c for c in provider.search(db_item) if c.external_id == body.external_id), None)
        if candidate is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Кандидат не найден среди результатов поиска: обнови список вариантов и выбери снова",
            )

        fill_details = getattr(provider, "fill_details", None)
        needs_genres = is_empty(db_item.genres) and is_empty(candidate.genres)
        needs_description = is_empty(db_item.description) and is_empty(candidate.description)
        if fill_details and (needs_genres or needs_description):
            candidate = fill_details(candidate)

        poster_path = None
        if candidate.poster_url and (force or is_empty(db_item.poster_url)):
            content, content_type = enricher.download(candidate.poster_url)
            poster_path = posters.save_poster(item_id, content, content_type)
    except HTTPException:
        raise
    except posters.PosterError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Источник отдал файл, непригодный как постер: {e}"
        ) from e
    except EXTERNAL_ERRORS as e:
        raise enrich_error(e) from e

    if force and poster_path:
        db_item.poster_url = None  # единственное исключение из правила «не перезаписывать»
    changed = apply_candidate(db_item, candidate, poster_url=poster_path)
    db.commit()
    db.refresh(db_item)
    return EnrichApplyResponse(item=MediaItemResponse.model_validate(db_item), changed=changed)


# --- AI-компаньон «Эпи»: диалоги с историей в БД, ответ приходит потоком SSE ---

def get_conversation_or_404(db: Session, conversation_id: int) -> AiConversation:
    conversation = db.get(AiConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    return conversation


@app.get("/ai/conversations", response_model=list[AiConversationResponse])
def list_ai_conversations(db: Session = Depends(get_db)):
    """Диалоги, недавно обновлённые первыми."""
    return db.query(AiConversation).order_by(AiConversation.updated_at.desc(), AiConversation.id.desc()).all()


@app.post("/ai/conversations", response_model=AiConversationResponse, status_code=status.HTTP_201_CREATED)
def create_ai_conversation(body: Optional[AiConversationCreate] = None, db: Session = Depends(get_db)):
    conversation = AiConversation(title=body.title if body and body.title else ai_conversations.DEFAULT_TITLE)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@app.get("/ai/conversations/{conversation_id}/messages", response_model=list[AiMessageResponse])
def list_ai_messages(conversation_id: int, db: Session = Depends(get_db)):
    """Последние 30 реплик диалога (без служебных вызовов инструментов) по порядку."""
    get_conversation_or_404(db, conversation_id)
    return ai_conversations.last_rows(db, conversation_id, visible_only=True)


@app.post("/ai/conversations/{conversation_id}/messages")
async def send_ai_message(
    conversation_id: int,
    body: AiMessageCreate,
    db: Session = Depends(get_db),
    enricher: Enricher = Depends(get_enricher),
):
    """Сохраняет реплику пользователя и стримит ответ Эпи событиями SSE.

    События: {"chunk": "..."} — кусок ответа; {"tool": "имя"} — Эпи вызвала инструмент; {"error": "..."} — сбой;
    в конце всегда [DONE]. Вызовы инструментов и полный ответ сохраняются в ai_messages.
    """
    try:
        settings = DeepSeekSettings.from_env()
    except AgentConfigError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e

    conversation = get_conversation_or_404(db, conversation_id)
    ai_conversations.add_message(db, conversation, {"role": "user", "content": body.content})
    history = ai_conversations.to_chat_messages(ai_conversations.last_rows(db, conversation_id))

    async def events():
        # Своя сессия: сессия запроса к моменту стриминга может быть уже закрыта
        session = SessionLocal()
        conv = None
        chunks: list[str] = []  # текст, ещё не сохранённый как сообщение: при обрыве клиента сохраняем что успели
        try:
            conv = session.get(AiConversation, conversation_id)
            try:
                async for event in run_agent(history, ToolContext(enricher=enricher), settings):
                    if event["type"] == "chunk":
                        chunks.append(event["text"])
                        yield ai_conversations.sse({"chunk": event["text"]})
                    elif event["type"] == "tool":
                        yield ai_conversations.sse({"tool": event["name"]})
                    else:
                        ai_conversations.add_message(session, conv, event["message"])
                        chunks.clear()
            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                reason = "ключ DeepSeek не принят" if code in (401, 403) else "лимит запросов или баланс исчерпан" if code in (402, 429) else f"ошибка {code}"
                yield ai_conversations.sse({"error": f"DeepSeek недоступен: {reason}"})
            except httpx.HTTPError:
                yield ai_conversations.sse({"error": "DeepSeek не ответил, попробуйте позже"})
            yield ai_conversations.SSE_DONE
        finally:
            if chunks and conv is not None:
                ai_conversations.add_message(session, conv, {"role": "assistant", "content": "".join(chunks)})
            session.close()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
