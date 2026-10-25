"""Импорт структурированного списка (JSON) в таблицу media_items.

Запуск из корня проекта:
    python -m scripts.import_json data/media.json             # импорт
    python -m scripts.import_json data/media.json --dry-run   # только проверка, без записи
    python -m scripts.import_json data/anime.json data/series.json   # несколько файлов

Код возврата: 0 — ошибок нет, 1 — были ошибки (записи с ошибками пропущены, остальные загружены).
"""
import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from pydantic import ValidationError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import MediaItem
from backend.schemas import MediaItemCreate

# Поля JSON, которые называются иначе, чем колонки таблицы
FIELD_MAP = {
    "season": "current_season",
    "episode": "current_episode",
    "volume": "current_volume",
    "chapter": "current_chapter",
}


@dataclass
class RecordError:
    """Запись, которую не удалось загрузить."""
    source: str  # файл, из которого взята запись
    index: int  # номер записи в файле, с 1
    raw: str  # исходная строка из старого списка (или название)
    field: str
    message: str

    def __str__(self) -> str:
        return f"{self.source} #{self.index} [{self.raw}]: {self.field} — {self.message}"


@dataclass
class ImportReport:
    total: int = 0
    added: Counter = field(default_factory=Counter)  # категория -> сколько записей добавлено
    duplicates: int = 0
    errors: list[RecordError] = field(default_factory=list)

    @property
    def added_total(self) -> int:
        return sum(self.added.values())


def clean(value):
    """Обрезает пробелы; пустую строку превращает в None."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def normalize_genres(genres) -> list:
    """Нижний регистр, без пустых значений и повторов, порядок сохраняется."""
    if genres is None:
        return []
    if not isinstance(genres, (list, tuple)):
        return genres  # не список: пусть отклонит валидация схемы
    result = []
    for genre in genres:
        if isinstance(genre, str):
            genre = genre.strip().lower()
            if not genre:
                continue
        if genre not in result:
            result.append(genre)
    return result


def to_item(record: dict) -> MediaItemCreate:
    """Превращает запись из JSON в проверенную схему. При ошибках бросает ValidationError."""
    data = {FIELD_MAP.get(key, key): clean(value) for key, value in record.items()}
    data["genres"] = normalize_genres(data.get("genres"))

    # Статус не импортируем: у всех записей будет значение по умолчанию 'planned'
    data.pop("status", None)

    # Неизвестные ключи (если появятся в JSON) Pydantic просто проигнорирует
    return MediaItemCreate(**data)


def dedup_key(title_ru: str, title_original: Optional[str], category: str) -> tuple:
    """Ключ дубликата: русское и оригинальное название и категория, без учёта регистра."""
    return (title_ru.casefold(), (title_original or "").casefold(), category)


def describe(record) -> str:
    if isinstance(record, dict):
        return str(record.get("raw") or record.get("title_ru") or "?")
    return repr(record)[:60]


def import_records(db: Session, records: list[tuple[str, int, object]], dry_run: bool = False) -> ImportReport:
    """Загружает записи в базу.

    records — список (источник, номер записи, запись). Ошибочные записи пропускаются и попадают в отчёт.
    При dry_run проверяется всё, включая дубликаты, но в базу ничего не пишется.
    """
    report = ImportReport(total=len(records))

    # Что уже есть в базе — чтобы повторный запуск не создавал дубли
    seen = {
        dedup_key(title_ru, title_original, category)
        for title_ru, title_original, category in db.query(
            MediaItem.title_ru, MediaItem.title_original, MediaItem.category
        )
    }

    for source, index, record in records:
        if not isinstance(record, dict):
            report.errors.append(
                RecordError(source, index, describe(record), "?", "запись не является объектом")
            )
            continue
        try:
            item = to_item(record)
        except ValidationError as e:
            first = e.errors()[0]
            field_name = ".".join(str(part) for part in first["loc"]) or "?"
            report.errors.append(RecordError(source, index, describe(record), field_name, first["msg"]))
            continue

        key = dedup_key(item.title_ru, item.title_original, item.category)
        if key in seen:
            report.duplicates += 1
            continue
        seen.add(key)

        if not dry_run:
            db.add(MediaItem(**item.model_dump()))
        report.added[item.category] += 1

    if not dry_run:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
    return report


def load_records(paths: list[str]) -> list[tuple[str, int, object]]:
    records = []
    for path in paths:
        try:
            with open(path, encoding="utf-8-sig") as f:
                data = json.load(f)
        except OSError as e:
            sys.exit(f"{path}: не удалось прочитать файл — {e.strerror or e}")
        except json.JSONDecodeError as e:
            sys.exit(f"{path}: некорректный JSON — {e}")
        if not isinstance(data, list):
            sys.exit(f"{path}: ожидался JSON-массив записей")
        records.extend((path, index, record) for index, record in enumerate(data, start=1))
    return records


def print_report(report: ImportReport, dry_run: bool) -> None:
    mode = "ПРОВЕРКА (в базу ничего не записано)" if dry_run else "ИМПОРТ"
    print(f"\n=== {mode} ===")
    print(f"Всего записей в файлах: {report.total}")
    print(f"{'Будет добавлено' if dry_run else 'Добавлено'}: {report.added_total}")
    for category, count in report.added.most_common():
        print(f"  {category}: {count}")
    print(f"Пропущено дубликатов: {report.duplicates}")
    print(f"Ошибок: {len(report.errors)}")
    for error in report.errors:
        print(f"  - {error}")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Импорт JSON-списка в Episodio")
    parser.add_argument("files", nargs="+", help="Путь к одному или нескольким JSON-файлам")
    parser.add_argument("--dry-run", action="store_true", help="Проверить без записи в базу")
    args = parser.parse_args(argv)

    records = load_records(args.files)

    db = SessionLocal()
    try:
        report = import_records(db, records, dry_run=args.dry_run)
    finally:
        db.close()

    print_report(report, args.dry_run)
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
