### Шаг 0. Название проекта

**Episodio** — личное хранилище для аниме, мультсериалов, сериалов, фильмов, телепередач, манги, книг и аудиокниг. Помогает отслеживать, что смотришь и читаешь: статус, текущий сезон/серию или том/главу, личную оценку, заметки, постеры и ссылки на источники.

**Исходные данные.** Старые хаотичные блокноты (`.txt`) уже один раз распарсены и превращены в структурированный JSON-список. Поэтому парсер на регулярных выражениях больше не нужен: импорт сводится к загрузке JSON в базу с проверкой полей.

Пример записи из JSON:

```json
{
  "title_ru": "Блудливая Калифорния",
  "title_original": "Californication",
  "category": "tv_series",
  "genres": ["драма", "комедия"],
  "country": "США",
  "release_year": 2007,
  "season": 7,
  "episode": 12,
  "translation": null,
  "comment": null,
  "raw": "Californication  7 сезон 12 серия"
}
```

### Шаг 1. Проектирование базы данных (модели данных)

Файл `scripts/schema.sql` — единственный источник правды о структуре БД. В ней две таблицы: `media_items` (библиотека) и `progress_log` (журнал отметок для ленты активности). Скрипт идемпотентный, его можно запускать повторно (`python -m scripts.init_db`).

```sql
CREATE TABLE IF NOT EXISTS media_items (
    id SERIAL PRIMARY KEY,

    -- Основная информация
    title_ru        VARCHAR(255) NOT NULL,
    title_original  VARCHAR(255),
    category        VARCHAR(50) NOT NULL
        CHECK (category IN ('anime','cartoon','tv_series','movie','tv_show','manga','book','audiobook')),
    genres          TEXT[] DEFAULT '{}',
    author          VARCHAR(255),                 -- Автор / мангака / писатель
    country         VARCHAR(100),
    release_year    INTEGER,
    description     TEXT,

    -- Статус
    status          VARCHAR(50) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('watching','completed','planned','dropped')),

    -- Прогресс сериалов/шоу (NULL = неприменимо или неизвестно)
    current_season  INTEGER CHECK (current_season  >= 0),
    current_episode INTEGER CHECK (current_episode >= 0),

    -- Прогресс книг/манги
    current_volume  INTEGER CHECK (current_volume  >= 0),
    current_chapter INTEGER CHECK (current_chapter >= 0),

    -- Сколько всего (NULL = неизвестно или неприменимо; у фильма не заполняется)
    total_episodes  INTEGER CHECK (total_episodes >= 0),
    total_chapters  INTEGER CHECK (total_chapters >= 0),

    -- Озвучка / перевод
    translation     VARCHAR(255),                 -- LostFilm, AniLibria, субтитры и т.п.

    -- Оценки и впечатления
    rating          INTEGER CHECK (rating BETWEEN 1 AND 10),
    comment         TEXT,

    -- Медиа и ссылки
    poster_url      TEXT,                         -- Путь к локальному файлу или внешний URL
    source_link     TEXT,

    -- Импорт
    raw             TEXT,                         -- Исходная строка из старого списка

    -- Служебные поля
    finished_at     TIMESTAMP,                    -- Ставит триггер при переходе в 'completed', сбрасывает при другом статусе
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Для баз, созданных до появления этих колонок (CREATE TABLE IF NOT EXISTS их не добавит)
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS total_episodes INTEGER CHECK (total_episodes >= 0);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS total_chapters INTEGER CHECK (total_chapters >= 0);
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS finished_at    TIMESTAMP;

-- Автообновление updated_at при любом изменении записи
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_items_updated_at ON media_items;
CREATE TRIGGER trg_media_items_updated_at
    BEFORE UPDATE ON media_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- finished_at: при переходе в 'completed' (или вставке сразу с ним) ставится текущее время,
-- если оно не задано явно; при любом другом статусе сбрасывается в NULL
CREATE OR REPLACE FUNCTION set_finished_at() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        IF NEW.finished_at IS NULL AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
            NEW.finished_at = CURRENT_TIMESTAMP;
        END IF;
    ELSE
        NEW.finished_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_items_finished_at ON media_items;
CREATE TRIGGER trg_media_items_finished_at
    BEFORE INSERT OR UPDATE ON media_items
    FOR EACH ROW EXECUTE FUNCTION set_finished_at();

-- Журнал прогресса: лента активности, «Продолжить», статистика по периодам
CREATE TABLE IF NOT EXISTS progress_log (
    id        SERIAL PRIMARY KEY,
    item_id   INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    unit      VARCHAR(20) NOT NULL
        CHECK (unit IN ('episode','chapter','movie')),
    number    INTEGER NOT NULL CHECK (number >= 0),   -- номер серии/главы; у фильма 1
    logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_progress_log_item_logged ON progress_log (item_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_log_logged ON progress_log (logged_at DESC);
```

#### Соответствие полей JSON и таблицы

| JSON | Таблица | Примечание |
|---|---|---|
| `title_ru`, `title_original`, `category`, `genres`, `country`, `release_year`, `translation`, `comment`, `raw` | одноимённые поля | |
| `season` | `current_season` | |
| `episode` | `current_episode` | |
| `volume`, `chapter` (если есть у книг/манги) | `current_volume`, `current_chapter` | |
| статуса в JSON нет | `status` | всем записям ставится `'planned'` (значение по умолчанию) |

#### Пояснения к схеме

1. **Несколько жанров.** Жанры хранятся массивом `TEXT[]`. Это позволяет делать фильтры вида «найти всё, где есть жанр „фэнтези“». Жанры приводятся к нижнему регистру и очищаются от повторов при записи через API, импорт и обогащение из внешних API, чтобы «Драма» и «драма» не считались разными жанрами. Фронтенд показывает их с заглавной буквы. Список имеющихся жанров отдаёт `GET /genres`.

2. **Прогресс = NULL, а не 1/0.** У фильмов нет сезонов, у сериалов нет томов. Поэтому значения по умолчанию у прогресса не задаются: NULL означает «неприменимо или неизвестно», и у фильма не появится фиктивный «1 сезон 0 серия».

3. **Статус при импорте.** В JSON статуса нет, поэтому все импортированные записи получают `planned`. Позже статусы можно поправить вручную или массово, например:

   ```sql
   UPDATE media_items
   SET status = 'watching'
   WHERE current_season IS NOT NULL OR current_episode IS NOT NULL;
   ```

4. **Перевод (`translation`).** Простая строка: LostFilm, AniLibria, «субтитры» и т.п. Если позже захочется фильтровать по студиям озвучки, это поле можно вынести в отдельный справочник.

5. **Исходная строка (`raw`).** Сохраняем строку из старого блокнота, по которой была собрана запись. Если парсер когда-то ошибся (например, принял год за сезон), запись можно перепроверить, не открывая старые файлы.

6. **Дата обновления (`updated_at`).** Обновляется автоматически при любом изменении записи: при прогрессе «+1 серия», новой оценке или комментарии. Это делает триггер в базе, а SQLAlchemy дублирует ту же логику через `onupdate`. Всегда видно, что смотрел или читал последним.

7. **Как работают постеры.**
   - Загружать картинки «на лету» с чужих сайтов при каждом открытии страницы — плохая идея: сайт тормозит, а если источник удалит картинку, в **Episodio** появятся битые иконки.
   - Поэтому при добавлении тайтла бэкенд находит постер через внешнее API (шаг 4) и **скачивает файл в папку проекта** `media/posters/`. В базе хранится только путь в `poster_url`, например `/posters/42.jpg`. База не раздувается, а папку с постерами легко бэкапить.
   - **Свой постер.** В интерфейсе будет кнопка «Загрузить свою картинку» (или вставить ссылку). Файл сохраняется в ту же папку и навсегда закрепляется за карточкой. Это удобно для редких книг и шоу, у которых нет постера в API.

8. **Сколько всего (`total_episodes`, `total_chapters`).** Парные поля к `current_episode` и `current_chapter`: по ним считаются прогресс-бар, «осталось» и автоматический переход в `completed`. `NULL` — общее число неизвестно (идущий сериал) или неприменимо (фильм). Страницы книг не храним: прогресс книг, манги и аудиокниг считается по главам.

9. **Описание (`description`).** Синопсис для карточки, его же может заполнить обогащение из внешних API. Личная заметка или рецензия лежит отдельно, в `comment`: отдельной таблицы отзывов нет, заметка к тайтлу одна.

10. **Дата завершения (`finished_at`).** Ставится триггером `set_finished_at`, когда статус становится `completed`, и сбрасывается в `NULL`, если статус изменили на другой. Триггер в БД срабатывает при любом способе записи (API, импорт, ручной SQL). Через API поле только читается. По нему строятся «витрины» (топ за год или месяц).

11. **Журнал (`progress_log`).** Каждая отметка «+1 серия» или «+1 глава» пишет строку `(item_id, unit, number, logged_at)`: `unit` — `episode`, `chapter` или `movie`. Из журнала строятся лента активности `/feed`, карточка «Продолжить» и статистика по периодам. Правила:
    - откат «−1» уменьшает счётчик и удаляет последнюю запись журнала этого тайтла, если она есть;
    - у фильма прогресса нет: при переходе в `completed` пишется запись `movie` с номером 1, при возврате в другой статус последняя запись удаляется;
    - записи журнала удаляются вместе с тайтлом (`ON DELETE CASCADE`).

### Шаг 2. Разработка бэкенда (FastAPI)

#### 2.1. Структура проекта

```
episodio/
│
├── requirements.txt      # Зависимости проекта
├── data/
│   └── media.json        # Структурированный список (результат разового парсинга)
└── backend/
    ├── schema.sql        # Создание таблицы (шаг 1)
    ├── database.py       # Подключение к PostgreSQL
    ├── models.py         # Описание таблицы для SQLAlchemy
    ├── schemas.py        # Pydantic-схемы: что API принимает и отдаёт
    ├── main.py           # Приложение FastAPI и эндпоинты
    └── import_json.py    # Импорт JSON в базу (шаг 3)
```

#### 2.2. `requirements.txt`

```
fastapi==0.150.0
uvicorn==0.54.0
sqlalchemy==2.1.5
psycopg2-binary==2.9.13
pydantic==2.13.5
```

> Версии из старого плана (pydantic 2.6, SQLAlchemy 2.0.28) не устанавливаются на свежем Python 3.13: pydantic-core не собирается. Версии выше проверены на Python 3.13.

#### 2.3. `database.py` — подключение к PostgreSQL

Строка подключения берётся из переменной окружения `DATABASE_URL`, а если её нет — используется значение по умолчанию. Пароль не придётся хранить в коде.

Драйвер указан явно (`postgresql+psycopg2://`): SQLAlchemy 2.1 для адреса `postgresql://` по умолчанию ищет другой драйвер (`psycopg` 3) и без него не запустится.

```python
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Замени user, password, host и dbname на свои или задай переменную окружения DATABASE_URL
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/episodio_db",
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

#### 2.4. `models.py` — таблица `media_items`

Модель повторяет `schema.sql` один к одному. Ограничения (CHECK) живут в самой базе, поэтому здесь их не дублируем.

```python
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.sql import func

from database import Base


class MediaItem(Base):
    __tablename__ = "media_items"

    id = Column(Integer, primary_key=True, index=True)

    # Основная информация
    title_ru = Column(String(255), nullable=False)
    title_original = Column(String(255))
    category = Column(String(50), nullable=False)
    genres = Column(ARRAY(Text), server_default="{}")
    author = Column(String(255))
    country = Column(String(100))
    release_year = Column(Integer)

    # Статус
    status = Column(String(50), nullable=False, server_default="planned")

    # Прогресс (NULL = неприменимо или неизвестно)
    current_season = Column(Integer)
    current_episode = Column(Integer)
    current_volume = Column(Integer)
    current_chapter = Column(Integer)

    # Озвучка / перевод
    translation = Column(String(255))

    # Оценки и впечатления
    rating = Column(Integer)
    comment = Column(Text)

    # Медиа и ссылки
    poster_url = Column(Text)
    source_link = Column(Text)

    # Импорт
    raw = Column(Text)

    # Служебные поля
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
```

#### 2.5. `schemas.py` — Pydantic-схемы

Схемы проверяют данные на входе: недопустимая категория, оценка 11 или отрицательная серия отсекаются ещё до базы с понятной ошибкой. Эти же схемы использует скрипт импорта.

```python
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Category = Literal[
    "anime", "cartoon", "tv_series", "movie",
    "tv_show", "manga", "book", "audiobook",
]
Status = Literal["watching", "completed", "planned", "dropped"]


class MediaItemBase(BaseModel):
    title_ru: str = Field(min_length=1, max_length=255)
    title_original: Optional[str] = Field(None, max_length=255)
    category: Category
    genres: list[str] = []
    author: Optional[str] = Field(None, max_length=255)
    country: Optional[str] = Field(None, max_length=100)
    release_year: Optional[int] = None

    status: Status = "planned"

    current_season: Optional[int] = Field(None, ge=0)
    current_episode: Optional[int] = Field(None, ge=0)
    current_volume: Optional[int] = Field(None, ge=0)
    current_chapter: Optional[int] = Field(None, ge=0)

    translation: Optional[str] = Field(None, max_length=255)

    rating: Optional[int] = Field(None, ge=1, le=10)
    comment: Optional[str] = None

    poster_url: Optional[str] = None
    source_link: Optional[str] = None

    raw: Optional[str] = None


class MediaItemCreate(MediaItemBase):
    pass


class MediaItemUpdate(BaseModel):
    """Частичное обновление: передаются только изменённые поля."""
    title_ru: Optional[str] = Field(None, min_length=1, max_length=255)
    title_original: Optional[str] = Field(None, max_length=255)
    category: Optional[Category] = None
    genres: Optional[list[str]] = None
    author: Optional[str] = Field(None, max_length=255)
    country: Optional[str] = Field(None, max_length=100)
    release_year: Optional[int] = None

    status: Optional[Status] = None

    current_season: Optional[int] = Field(None, ge=0)
    current_episode: Optional[int] = Field(None, ge=0)
    current_volume: Optional[int] = Field(None, ge=0)
    current_chapter: Optional[int] = Field(None, ge=0)

    translation: Optional[str] = Field(None, max_length=255)

    rating: Optional[int] = Field(None, ge=1, le=10)
    comment: Optional[str] = None

    poster_url: Optional[str] = None
    source_link: Optional[str] = None


class MediaItemResponse(MediaItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
```

#### 2.6. `main.py` — эндпоинты (CRUD)

Таблица создаётся скриптом `schema.sql`, а не через `Base.metadata.create_all`, потому что `create_all` не создаёт триггер и CHECK-ограничения.

CORS разрешён для локального фронтенда (порт 5173 у Vite, 3000 у Next.js), иначе браузер не пустит React-приложение к API.

```python
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import MediaItem
from schemas import Category, MediaItemCreate, MediaItemResponse, MediaItemUpdate, Status

app = FastAPI(
    title="Episodio API",
    description="Личное хранилище аниме, сериалов, фильмов, манги и книг.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_item_or_404(db: Session, item_id: int) -> MediaItem:
    item = db.get(MediaItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Элемент не найден")
    return item


@app.get("/")
def read_root():
    return {"message": "Добро пожаловать в Episodio API! 🎬📚"}


# 1. Список с фильтрами: категория, статус, жанр и поиск по названию
@app.get("/items/", response_model=list[MediaItemResponse])
def list_items(
    category: Optional[Category] = None,
    item_status: Optional[Status] = Query(None, alias="status"),
    genre: Optional[str] = None,
    q: Optional[str] = Query(None, description="Поиск по русскому или оригинальному названию"),
    db: Session = Depends(get_db),
):
    query = db.query(MediaItem)
    if category:
        query = query.filter(MediaItem.category == category)
    if item_status:
        query = query.filter(MediaItem.status == item_status)
    if genre:
        query = query.filter(MediaItem.genres.any(genre.lower()))
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            or_(MediaItem.title_ru.ilike(pattern), MediaItem.title_original.ilike(pattern))
        )
    return query.order_by(MediaItem.updated_at.desc()).all()


# 2. Одна запись
@app.get("/items/{item_id}", response_model=MediaItemResponse)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return get_item_or_404(db, item_id)


# 3. Добавить запись
@app.post("/items/", response_model=MediaItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(item: MediaItemCreate, db: Session = Depends(get_db)):
    db_item = MediaItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


# 4. Частично обновить запись (прогресс, оценку, статус, заметку...)
@app.patch("/items/{item_id}", response_model=MediaItemResponse)
def update_item(item_id: int, item_update: MediaItemUpdate, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    for key, value in item_update.model_dump(exclude_unset=True).items():
        setattr(db_item, key, value)
    db.commit()
    db.refresh(db_item)
    return db_item


# 5. Удалить запись
@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    db_item = get_item_or_404(db, item_id)
    db.delete(db_item)
    db.commit()
    return None
```

#### 2.7. Что умеет бэкенд

- **`GET /items/`** — список с фильтрами: `?category=anime`, `?status=watching`, `?genre=драма`, `?q=калифорния`. Свежеобновлённые записи идут первыми.
- **`GET /items/{id}`** — одна карточка.
- **`POST /items/`** — добавить аниме, сериал, книгу и т.д.
- **`PATCH /items/{id}`** — изменить только переданные поля, например `{"current_episode": 6}` или `{"rating": 9}`. Именно `PATCH`, а не `PUT`, потому что обновление частичное.
- **`DELETE /items/{id}`** — удалить запись.

#### 2.8. Первый запуск

```bash
# 1. Создать базу и таблицу
createdb -U postgres episodio_db
psql -U postgres -d episodio_db -f backend/schema.sql

# 2. Установить зависимости
pip install -r requirements.txt

# 3. Запустить API (из папки backend)
cd backend
uvicorn main:app --reload
```

FastAPI автоматически сгенерирует интерактивную документацию Swagger UI по адресу http://127.0.0.1:8000/docs. Там можно тестировать все запросы прямо в браузере, без фронтенда.

### Шаг 3. Импорт данных из JSON

Старые `.txt`-блокноты (аниме, мультсериалы, сериалы, телепередачи, прочитанное, аудиокниги, «Надо глянуть») уже собраны в структурированный JSON. Регулярные выражения и угадывание категорий по ключевым словам больше не нужны: скрипт только переименовывает поля, проверяет данные и загружает их в базу.

#### Что делает скрипт

- Переименовывает `season`/`episode` (и `volume`/`chapter`, если они есть) в колонки `current_*`.
- Превращает пустые строки в NULL, а жанры приводит к нижнему регистру без повторов.
- Не переносит статус: у всех записей будет `planned`.
- Проверяет каждую запись той же Pydantic-схемой, что и API. Записи с ошибками (неизвестная категория, нет названия, оценка вне 1–10) не загружаются, а выводятся списком с указанием строки `raw`.
- Пропускает дубликаты: запись считается дублем, если совпадают русское название, оригинальное название и категория (без учёта регистра). Поэтому скрипт можно безопасно запускать повторно: исправил ошибки в JSON, запустил ещё раз, и загрузится только недостающее.
- Режим `--dry-run` всё проверяет, но ничего не записывает в базу.
- Принимает один или несколько JSON-файлов: если список разбит по категориям на несколько файлов, их можно передать все сразу.

#### Скрипт `backend/import_json.py`

```python
"""Импорт структурированного списка (JSON) в таблицу media_items.

Запуск из папки backend:
    python import_json.py ../data/media.json             # импорт
    python import_json.py ../data/media.json --dry-run   # только проверка, без записи
    python import_json.py ../data/anime.json ../data/series.json   # несколько файлов
"""
import argparse
import json
import sys
from collections import Counter

from pydantic import ValidationError

from database import SessionLocal
from models import MediaItem
from schemas import MediaItemCreate

# Поля JSON, которые называются иначе, чем колонки таблицы
FIELD_MAP = {
    "season": "current_season",
    "episode": "current_episode",
    "volume": "current_volume",
    "chapter": "current_chapter",
}


def clean(value):
    """Обрезает пробелы; пустую строку превращает в None."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def to_item(record: dict) -> MediaItemCreate:
    data = {FIELD_MAP.get(key, key): clean(value) for key, value in record.items()}

    # Жанры: нижний регистр, без пустых значений и повторов, порядок сохраняется
    genres = data.get("genres") or []
    data["genres"] = list(dict.fromkeys(g.strip().lower() for g in genres if g and g.strip()))

    # Статус не импортируем: у всех записей будет значение по умолчанию 'planned'
    data.pop("status", None)

    # Неизвестные ключи (если появятся в JSON) Pydantic просто проигнорирует
    return MediaItemCreate(**data)


def dedup_key(title_ru: str, title_original, category: str) -> tuple:
    return (title_ru.casefold(), (title_original or "").casefold(), category)


def load_records(paths: list[str]) -> list[tuple[str, int, object]]:
    records = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            sys.exit(f"{path}: ожидался JSON-массив записей")
        records.extend((path, index, record) for index, record in enumerate(data, start=1))
    return records


def describe(record) -> str:
    if isinstance(record, dict):
        return record.get("raw") or record.get("title_ru") or "?"
    return repr(record)[:60]


def main():
    parser = argparse.ArgumentParser(description="Импорт JSON-списка в Episodio")
    parser.add_argument("files", nargs="+", help="Путь к одному или нескольким JSON-файлам")
    parser.add_argument("--dry-run", action="store_true", help="Проверить без записи в базу")
    args = parser.parse_args()

    records = load_records(args.files)

    db = SessionLocal()
    try:
        # Что уже есть в базе — чтобы повторный запуск не создавал дубли
        seen = {
            dedup_key(t, o, c)
            for t, o, c in db.query(MediaItem.title_ru, MediaItem.title_original, MediaItem.category)
        }

        added = Counter()
        duplicates = 0
        errors = []

        for path, index, record in records:
            if not isinstance(record, dict):
                errors.append(f"{path} #{index}: запись не является объектом — {describe(record)}")
                continue
            try:
                item = to_item(record)
            except ValidationError as e:
                first = e.errors()[0]
                field = ".".join(str(part) for part in first["loc"])
                errors.append(f"{path} #{index} [{describe(record)}]: {field} — {first['msg']}")
                continue

            key = dedup_key(item.title_ru, item.title_original, item.category)
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)

            db.add(MediaItem(**item.model_dump()))
            added[item.category] += 1

        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    mode = "ПРОВЕРКА (в базу ничего не записано)" if args.dry_run else "ИМПОРТ"
    print(f"\n=== {mode} ===")
    print(f"Всего записей в файлах: {len(records)}")
    print(f"Добавлено: {sum(added.values())}")
    for category, count in added.most_common():
        print(f"  {category}: {count}")
    print(f"Пропущено дубликатов: {duplicates}")
    print(f"Ошибок: {len(errors)}")
    for line in errors:
        print(f"  ✗ {line}")


if __name__ == "__main__":
    main()
```

#### Как запустить импорт

1. Положи JSON в `episodio/data/media.json` (или укажи свой путь при запуске).
2. Убедись, что PostgreSQL запущен и таблица создана (шаг 2.8).
3. Сначала проверка, затем импорт (из папки `backend`):

   ```bash
   python import_json.py ../data/media.json --dry-run
   python import_json.py ../data/media.json
   ```

4. Если скрипт показал ошибки, исправь соответствующие записи в JSON и запусти ещё раз. Уже загруженные записи будут пропущены как дубликаты.

После импорта все записи сразу доступны через `GET /items/` и появятся в **Episodio** со статусом `planned`.

### Шаг 4. Подключение внешних API (обогащение карточек)

После импорта у записей есть названия, категория, жанры, страна и год, но нет постеров, а у книг часто нет автора. Внешние API нужны, чтобы дозаполнить пустые поля, не вбивая их вручную.

| Категория | Источник | Что берём |
|---|---|---|
| `anime`, `manga` | **Shikimori** (хорошо знает русские названия), **AniList** или **Jikan (MyAnimeList)** | постер, автор манги, жанры, год |
| `tv_series`, `movie`, `tv_show`, `cartoon` | **TMDB** (бесплатный API-ключ), запасной вариант — **TVMaze** | постер, жанры, страна, год |
| `book`, `audiobook` | **Open Library** или **Google Books** | обложка, автор, год |

#### Принципы

- **Искать по `title_original` + `release_year`.** Теперь эти поля есть в JSON, и это гораздо точнее, чем поиск по русскому названию из старых блокнотов. Если оригинального названия нет, искать по `title_ru`.
- **Заполнять только пустые поля.** Ручные правки (свой постер, исправленный жанр) никогда не перезаписываются.
- **Сомнительные совпадения не применять автоматически.** Если API вернуло несколько похожих кандидатов (ремейки, одноимённые фильмы), запись помечается и предлагается выбрать вариант вручную.
- **Постеры скачивать локально** в `media/posters/{id}.jpg` (см. шаг 1, п. 7) и отдавать через FastAPI `StaticFiles`. В `poster_url` записывать путь `/posters/{id}.jpg`.
- **Два режима запуска:** пакетный скрипт, который один раз проходит по всем импортированным записям, и автоматический поиск при добавлении нового тайтла через API.
- **Соблюдать лимиты API:** делать паузы между запросами, а для Shikimori указывать свой `User-Agent`.

> Описание (синопсис) хранится в поле `description` (шаг 1). Провайдеры пока его не заполняют: это можно добавить, когда понадобится показывать синопсис из внешних источников.

### Шаг 5. Разработка Фронтенда (React)

Чтобы твой сайт выглядел ультрасовременно в 2026 году и вызывал восторг у топовых продуктовых дизайнеров, он должен сочетать **бруталистичный минимализм, высокую функциональность с ИИ и живой, иммерсивный UX**.

### 1. UX (User Experience) мирового уровня

Главная проблема большинства трекеров — рутина: нужно зайти, найти сериал, кликнуть на сезон, выбрать серию, нажать «сохранить». В 2026 году это считается моветоном. UX должен быть бесшовным (frictionless):

- **⚡ Мгновенный поиск и Cmd+K (Command Palette):** Вся навигация и добавление контента должны управляться с клавиатуры через глобальное окно поиска (как в Linear или Raycast). Нажимаешь `Cmd + K` (или `Ctrl + K`), вводишь пару букв («JJK» или «Атака»), и сайт моментально предлагает отметить серию или добавить тайтл.
- **🎯 Интерактивный «просмотр на лету» (Quick Log):** На главном экране (твоем дашборде) карточки сериалов/аниме должны иметь элементы управления прямо на обложке. Посмотрел серию за ужином? Один клик по круглой кнопке с плюсиком на карточке — и счетчик серии инкрементируется с приятной микроанимацией (haptic-like feel).
- **🌊 Бесконечный скролл и контекстные таймлайны:** Лента активности должна выглядеть не как скучная таблица из базы данных, а как красивый визуальный дневник (timeline), где видно, в какие дни ты что смотрел, с динамическими графиками времени.
- **📱 Mobile-First с жестами:** Большинство треков контента закрываются с телефона (лежа в кровати после просмотра серии). Интерфейс должен поддерживать свайпы (например, свайп вправо по карточке сериала — отметить серию просмотренной, свайп влево — открыть детали).

### 2. Топовые функции и фишки (Функциональность 2026 года)

Чтобы сайт не был просто «списком с галочками», внедрил фишки, которые выводят его на уровень премиальных SaaS-продуктов:

- **🤖 AI-компаньон и умные инсайты (GenAI Integration):**

  - *Авто-суфлер по впечатлениям:* Написал пару слов в поле ввода («серия топ, но концовка слита»), а ИИ структурирует это в красивую рецензию, выделит теги и поставит честный рейтинг.
  - *Рекомендации «Что посмотреть дальше»:* Анализ твоих вкусов на основе паттернов просмотра с генерацией персонального синопсиса под твоё настроение.

- **📊 Продвинутая аналитика (The Wrapped Experience):** Красивые интерактивные дашборды (в стиле Spotify Wrapped, но доступные круглый год):

  - 

    **🎭 Любимые жанры и страны:**

    - Круговые диаграммы или шкалы прогресса на основе массива `genres` (`драма`, `комедия`) и поля `country` (`США`, `Япония`). Сразу будет видно, чего ты смотришь больше — американских драм или японского аниме.

    

    **📈 Распределение по годам релиза (`release_year`):**

    - График, показывающий, контент каких годов тебе ближе: современный (2025–2026) или ностальгический классический (как Californication 2007 года или старое аниме).

    **🏆 Топ тайтлов по количеству серий:**

    - Рейтинг сериалов, на которые ты потратил больше всего времени (по количеству залогированных серий суммарно для каждого `title_ru`).

- **🔄 Автоматическая синхронизация (Webhooks / API):** Интеграция с внешними публичными API (AniList, MyAnimeList, TMDB) по одному клику: вставил ссылку на тайтл, и сайт сам подтянул синопсис, постер в высоком разрешении, количество серий и статус выхода.

- **🔗 Публичные «витрины» (Shareable Profile):** Возможность одной кнопкой сделать красивую публичную страницу («Мой топ аниме 2026») с уникальной ссылкой, которую не стыдно скинуть друзьям или закинуть в портфолио.

### 3. Визуальный стиль и дизайн (UI 2026)

Забудь про плоский минимализм 2010-х и шаблонный Material Design. Тренд 2026 года — **«Bento Grid + Dark-Mode Luxury»** с элементами футуристичного интерфейса.

#### 🎨 Цветовая палитра: (Темная тема)

- #### «Nordic Twilight» (Мягкая прохлада / Notion-like)

  *Уютный, приглушенный стиль, который не утомляет глаза при ночном просмотре.*

  - **Фон:** `#[0F172A]` (темный серо-синий Slate).
  - **Карточки:** `#[1E293B]`.
  - **Акцент:** **Soft Teal / Cyan** (`#[2DD4BF]` или `#[38BDF8]`) — бирюзово-голубое свечение, ассоциирующееся с глубоким космосом или современными медиаплеерами.

### ☀️ Палитра: «Nordic Frost» (Светлая тема)

- **Фон (Background):** `#[F8FAFC]` (очень мягкий серовато-голубой оттенок, известный как *Slate 50* — он гораздо приятнее для глаз, чем чистый белый `#[FFFFFF]`).
- **Карточки и блоки (Surfaces):** `#[FFFFFF]` (чисто-белые карточки, которые красиво приподнимаются над фоном за счет тонкой тени и едва заметной рамки `#[E2E8F0]`).
- **Текст основной:** `#[0F172A]` (глубокий серо-синий Slate — тот самый цвет фона из темной темы, что создает идеальную преемственность стилей).
- **Текст второстепенный:** `#[64748B]` (приглушенный серый для дат, подзаписей и счетчиков).
- **Акцент (Accent):** Тот же **Soft Teal / Cyan** (`#[0D9488]` или `#[0284C7]`), но чуть более насыщенный, чтобы он контрастно и читаемо смотрелся на светлом фоне.

#### 🔠 Типографика:

- ####  «The Tech Standard» (Современно, технологично, как у Linear/Vercel)

  - **Для заголовков и акцентов:** **Geist** (или **Geist Sans**) от Vercel. У него потрясающие пропорции, он создан специально для цифровых интерфейсов будущего.
  - **Для основного текста:** **Inter** или **Plus Jakarta Sans**. Читаемость на любых экранах (даже на самом мелком смартфоне) абсолютная.

#### 🪟 Визуальные фишки UI:

- **Glassmorphism нового поколения:** Полупрозрачные плашки с размытием фона (`backdrop-filter: blur`), но с тонкими, едва заметными светящимися границами (border gradients), создающими ощущение глубины и многослойности.
- **Bento Grid Layout:** Организация блоков на странице (статистика, текущий сериал, последние рецензии) в виде аккуратной сетки из карточек разного размера (как на презентациях Apple).
- **Микроанимации (Framer Motion / View Transitions API):** Плавные переходы при смене страниц, «живые» тени, мягкое увеличение карточек при наведении (scale & elevation) и скелетоны загрузки вместо резких рывков контента.

### Резюме архитектуры стека (если будешь писать сам или с помощью ИИ):

- **Фронтенд:** Next.js (React) + Tailwind CSS + Framer Motion (для тех самых анимаций анимации).
- **Дизайн-система:** Вдохновляйся сайтами **Vercel, Linear, Raycast, Sentry** и визуальными трендами на **Awwwards / Dribbble** в категории *Dark Mode SaaS / Bento Grid*.