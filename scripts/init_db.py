"""Создание структуры БД из scripts/schema.sql.

Запуск из корня проекта:
    python -m scripts.init_db                              # применить схему (безопасно повторять)
                                                           # URL: DATABASE_URL или DB_* из .env
    python -m scripts.init_db --database-url postgresql+psycopg2://...   # другая база
    python -m scripts.init_db --reset                      # сначала удалить таблицу (с подтверждением)
    python -m scripts.init_db --reset --yes                # то же, без вопроса
"""
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from backend.database import get_database_url, normalize_url

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

RESET_SQL = [
    "DROP TRIGGER IF EXISTS trg_media_items_updated_at ON media_items",
    "DROP TRIGGER IF EXISTS trg_media_items_finished_at ON media_items",
    "DROP TABLE IF EXISTS showcases",
    "DROP TABLE IF EXISTS progress_log",
    "DROP TABLE IF EXISTS media_items",
    "DROP FUNCTION IF EXISTS set_updated_at()",
    "DROP FUNCTION IF EXISTS set_finished_at()",
]


def apply_schema(engine, reset: bool = False) -> int:
    """Применяет scripts/schema.sql в одной транзакции и возвращает число записей в media_items.

    При reset=True сначала удаляет таблицы (media_items и progress_log), триггеры и функции. Подтверждение запрашивает вызывающий код.
    """
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    # Одна транзакция: при любой ошибке база остаётся как была
    with engine.begin() as conn:
        if reset:
            for statement in RESET_SQL:
                conn.exec_driver_sql(statement)
        conn.exec_driver_sql(schema_sql)
        return conn.execute(text("SELECT COUNT(*) FROM media_items")).scalar_one()


def main():
    load_dotenv(ROOT / ".env")

    parser = argparse.ArgumentParser(description="Создание структуры БД Episodio")
    parser.add_argument("--database-url", help="Строка подключения (по умолчанию DATABASE_URL из .env)")
    parser.add_argument("--reset", action="store_true",
                        help="Перед применением схемы удалить таблицу media_items, триггер и функцию")
    parser.add_argument("--yes", action="store_true", help="Не спрашивать подтверждение для --reset")
    args = parser.parse_args()

    url = normalize_url(args.database_url) if args.database_url else get_database_url()
    target = url.render_as_string(hide_password=True)

    if args.reset and not args.yes:
        print(f"ВНИМАНИЕ: будут удалены таблица media_items со всеми данными, триггер и функция в базе {target}")
        try:
            answer = input("Продолжить? (y/N): ").strip().lower()
        except EOFError:
            answer = ""
        if answer not in ("y", "yes", "д", "да"):
            sys.exit("Отменено.")

    engine = create_engine(url)
    try:
        count = apply_schema(engine, reset=args.reset)
    finally:
        engine.dispose()
    if args.reset:
        print("Таблица media_items, триггер и функция были удалены перед применением схемы.")

    print(f"Схема применена: {target}")
    print(f"Записей в media_items: {count}")


if __name__ == "__main__":
    main()
