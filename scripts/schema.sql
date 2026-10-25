-- Структура БД Episodio — единственный источник правды.
-- Скрипт идемпотентный: его можно запускать повторно без ошибок.

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

-- Витрины: публичные страницы «мой топ» (категория, год и месяц завершения, число мест)
CREATE TABLE IF NOT EXISTS showcases (
    id         SERIAL PRIMARY KEY,
    slug       VARCHAR(64) NOT NULL UNIQUE
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),   -- адрес: латиница, цифры и дефисы
    title      VARCHAR(120) NOT NULL,
    category   VARCHAR(50)
        CHECK (category IN ('anime','cartoon','tv_series','movie','tv_show','manga','book','audiobook')),  -- NULL = все
    year       INTEGER CHECK (year BETWEEN 1900 AND 2100),   -- год завершения (finished_at); NULL = за всё время
    month      INTEGER CHECK (month BETWEEN 1 AND 12),       -- месяц завершения, только вместе с годом
    max_items  INTEGER NOT NULL DEFAULT 8 CHECK (max_items BETWEEN 1 AND 50),
    is_public  BOOLEAN NOT NULL DEFAULT FALSE,               -- пока FALSE, публичный адрес отвечает 404
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (month IS NULL OR year IS NOT NULL)
);
