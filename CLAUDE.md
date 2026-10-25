# Episodio — правила проекта

## О проекте

Episodio — личный трекер для одного пользователя: аниме, мультсериалы, сериалы, фильмы, телепередачи, манга, книги, аудиокниги. Статус, прогресс, оценка, заметки, постеры. Подробный план: `docs/plan.md`.

## Стек

Python 3.12+, FastAPI, SQLAlchemy 2.x, Pydantic 2, PostgreSQL 16+ (стоит локально, не в Docker), pytest.
Фронтенд: Next.js 16 (App Router, TypeScript) + Tailwind CSS 4 + Framer Motion + Zustand, лежит в `frontend/` (подробности — `frontend/README.md`). Дизайн-референсы — `docs/design_handoff_episodio/`, бренд — `docs/episodio-brand/`.

## Структура

- `backend/` — пакет приложения (database, models, schemas, main)
- `scripts/` — миграции и импорт (`init_db`, `import_json`, `schema.sql`)
- `tests/` — тесты, `tests/fixtures/` — тестовые данные
- `frontend/` — веб-интерфейс (Next.js): `src/app` — экраны, `src/components`, `src/lib` (store, правила, i18n, auth), `public/` — PWA и бренд
- `data/` — личные данные (в git не попадают, для ИИ закрыты)
- `media/posters/` — файлы постеров
- `docs/plan.md` — план разработки
- `docs/roadmap_frontend_v2.md` — **актуальная дорожная карта фронтенда**: статус этапов, текущий контракт API, принятые решения, промпты для оставшихся этапов (`roadmap_frontend.md` и `api-contract.md` — история). Начинай новую сессию с него

## Команды

Всё запускается из корня проекта.

```bash
.venv\Scripts\Activate.ps1                  # Windows (PowerShell)
source .venv/bin/activate                   # macOS / Linux
python -m scripts.init_db                   # создать таблицу из scripts/schema.sql
uvicorn backend.main:app --reload --host 127.0.0.1   # API, Swagger: http://127.0.0.1:8000/docs
python -m scripts.import_json data/media.json --dry-run   # проверка импорта без записи
python -m scripts.enrich --category anime --limit 5 --dry-run   # обогащение из внешних API (TMDB, Shikimori, Open Library)
pytest                                      # тесты
```

Фронтенд (из папки `frontend/`):

```bash
npm install
npm run dev                                 # http://localhost:3000, логин/пароль из корневого .env (AUTH_LOGIN, AUTH_PASSWORD, AUTH_SECRET)
npm run typecheck                           # проверка типов
npm test                                    # vitest
npm run build                               # production-сборка
```

## Правила

- Всё запускается из корня проекта; импорты абсолютные: `from backend.xxx import ...`.
- Единственный источник правды о структуре БД — `scripts/schema.sql`. `Base.metadata.create_all` не использовать. Любое изменение таблицы = правка `schema.sql` + `models.py` + `schemas.py` одновременно.
- Допустимые значения: `category` — anime, cartoon, tv_series, movie, tv_show, manga, book, audiobook; `status` — watching, completed, planned, dropped; `rating` — 1–10.
- Поля прогресса (`current_season/episode/volume/chapter`) по умолчанию NULL, а не 1/0.
- Обновление записей — PATCH с частичными данными.
- При импорте статус не переносится: все записи получают `planned`.
- Новый источник данных = класс-провайдер в backend/enrich/ (интерфейс Provider из base.py), регистрация в PROVIDER_CLASSES в backend/enrich/registry.py; соблюдать лимиты запросов API и подписывать запросы User-Agent. Категорию может обслуживать несколько источников (у аниме и манги Shikimori и AniList): по умолчанию берётся первый в PROVIDER_CLASSES, другой выбирается явно (`source`, `--source`).
- Внешние API (backend/enrich/) в тестах не вызывать: только httpx.MockTransport и ответы из tests/fixtures/.
- Постеры хранятся файлами в `media/posters/`, в БД — только путь (`poster_url`).
- Обогащение из внешних API заполняет только пустые поля и никогда не перезаписывает ручные правки. Единственное исключение: `POST /items/{id}/enrich/apply?force=true` заменяет постер (и только его).
- Ошибки внешних API в эндпоинтах отдаются как 502 (сервис недоступен) или 503 (не настроен), не как 500.
- Публичные витрины: единственное исключение из защиты фронтенда — страница `/u/<имя>/<адрес>` и её постеры `/u/<имя>/<адрес>/poster/<файл>` (`isPublicPath` в `frontend/src/lib/guard.ts`); FastAPI-эндпоинты `/public/showcases/...` по-прежнему требуют ключ, сервер Next.js ходит в них сам. Публичный ответ собирается только из полей `ShowcaseItem` (`backend/schemas.py`): новое поле туда добавляется осознанно, вместе с тестом на утечки в `tests/test_showcases.py`.
- Тесты, которые вызывают `scripts.enrich.main()`, обязаны подменять `SessionLocal` (иначе подключатся к рабочей базе из `.env`); фикстура `clean_env` в `tests/test_enrich_providers.py` запрещает рабочую базу по умолчанию.
- Защита API: если в окружении задан `API_KEY`, все эндпоинты, кроме `/`, `/health` и `/posters/...`, требуют заголовок `X-API-Key`; новые эндпоинты защищены автоматически (зависимость на уровне приложения), в тестах ключ снимает фикстура `no_api_key`.
- Прогресс серий/глав меняется только через `POST /items/{id}/progress` (он ведёт журнал `progress_log`), а не прямым PATCH счётчика; `finished_at` ставит триггер БД и через API не меняется.
- Жанры хранятся и отдаются строго в нижнем регистре (нормализация в `backend/schemas.py`), на фронтенде показываются с заглавной.
- Секреты — только в `.env`; `.env` не читать и не коммитить. Зависимости ставить только в `.venv`.
- Новый код сопровождается тестами; перед тем как сказать «готово», запустить `pytest`.
- Фронтенд: логин, пароль и секрет сессии только из `.env` (`AUTH_*`, читается из корня проекта через `frontend/next.config.ts`); цвета — токены темы из `globals.css`, строки интерфейса — русские ключи словаря `t("...")` с переводом в `src/lib/dict.ts` / `i18n-core.ts`; новая логика в `src/lib` сопровождается vitest-тестами. Данные (библиотека, лента) хранятся в БД на сервере; Zustand держит их копию с оптимистичными правками. К FastAPI фронтенд ходит только через слой `src/lib/api.ts` и серверный прокси `/api/backend/*` (он подставляет `X-API-Key`), не из компонентов и не напрямую из браузера. В localStorage остаются только тема, язык и мелкие настройки.
- Не добавлять без запроса: Alembic, Docker для бэкенда, новые зависимости (включая npm-пакеты фронтенда).
- Комментарии и сообщения для пользователя — на русском.
