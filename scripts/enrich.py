"""Обогащение карточек данными из внешних API (постер, жанры, страна, год, автор).

Провайдер выбирается по категории: TMDB (сериалы, фильмы, телепередачи, мультсериалы; если ключа нет, то TheTVDB),
Shikimori (аниме, манга), Open Library (книги, аудиокниги). Другой источник выбирается через --source.

Запуск из корня проекта:
    python -m scripts.enrich                                  # все записи, которым есть что дополнить
    python -m scripts.enrich --category tv_series --limit 5   # только сериалы, не больше 5 записей
    python -m scripts.enrich --id 42                          # одна запись
    python -m scripts.enrich --dry-run                        # показать, что изменится, ничего не записывая

Заполняются только пустые поля, ручные правки не перезаписываются. Неоднозначные и ненайденные записи
сохраняются в data/enrich_review.json, чтобы выбрать вариант вручную.
Код возврата: 0 — ошибок нет, 1 — были ошибки, 2 — обогащение невозможно (нет настроек или ключ не принят).
"""
import argparse
import json
import sys
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Callable, Iterable, Optional

import httpx
from dotenv import load_dotenv
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.enrich.base import (
    Candidate,
    Provider,
    ProviderAuthError,
    ProviderError,
    apply_candidate,
    find_matches,
    is_empty,
)
from backend.enrich.registry import ALL_CATEGORIES, PROVIDER_CLASSES, build_providers, make_downloader
from backend.models import MediaItem
from backend.posters import PosterError, save_poster

ROOT = Path(__file__).resolve().parent.parent
REVIEW_PATH = ROOT / "data" / "enrich_review.json"

# Поля, которые умеет дополнять обогащение
ENRICHABLE_FIELDS = ("poster_url", "genres", "country", "release_year")


@dataclass
class EnrichReport:
    enriched: int = 0
    unchanged: int = 0  # совпадение найдено, но заполнять нечего
    ambiguous: int = 0
    not_found: int = 0
    errors: list[str] = field(default_factory=list)
    review: list[dict] = field(default_factory=list)  # записи для ручного выбора
    processed_ids: list[int] = field(default_factory=list)


def needs_enrichment(item: MediaItem) -> bool:
    return any(is_empty(getattr(item, name)) for name in ENRICHABLE_FIELDS)


def select_items(
    db: Session,
    categories: Iterable[str],
    category: Optional[str] = None,
    item_id: Optional[int] = None,
    limit: Optional[int] = None,
) -> list[MediaItem]:
    """Записи, которым есть что дополнить, в порядке id."""
    query = select(MediaItem).where(MediaItem.category.in_([category] if category else list(categories)))
    if item_id is not None:
        query = query.where(MediaItem.id == item_id)
    items = [item for item in db.scalars(query.order_by(MediaItem.id)) if needs_enrichment(item)]
    return items[:limit] if limit else items


def review_entry(item: MediaItem, reason: str, candidates: list[Candidate]) -> dict:
    return {
        "id": item.id,
        "title_ru": item.title_ru,
        "title_original": item.title_original,
        "category": item.category,
        "release_year": item.release_year,
        "reason": reason,  # "ambiguous" — несколько совпадений, "not_found" — ни одного
        "candidates": [asdict(c) for c in candidates],
    }


def run_enrich(
    db: Session,
    items: list[MediaItem],
    provider_for: Callable[[MediaItem], Optional[Provider]],
    download: Callable[[str], tuple[bytes, str]],
    dry_run: bool = False,
    log: Callable[[str], None] = print,
) -> EnrichReport:
    """Обогащает записи. Ошибка одной записи не останавливает остальные (кроме отказа в доступе)."""
    report = EnrichReport()

    for item in items:
        label = f"[{item.id}] {item.title_ru}"
        provider = provider_for(item)
        if provider is None:
            continue
        report.processed_ids.append(item.id)

        try:
            candidates = provider.search(item)
        except ProviderAuthError:
            raise
        except (httpx.HTTPError, ProviderError) as e:
            report.errors.append(f"{label}: поиск не удался — {e}")
            log(f"{label}: ОШИБКА поиска")
            continue

        matches = find_matches(item, candidates)
        if not matches:
            report.not_found += 1
            report.review.append(review_entry(item, "not_found", candidates))
            log(f"{label}: не найдено")
            continue
        if len(matches) > 1:
            report.ambiguous += 1
            report.review.append(review_entry(item, "ambiguous", matches))
            log(f"{label}: неоднозначно ({len(matches)} кандидатов)")
            continue

        candidate = matches[0]

        # Часть данных (жанры Shikimori) не приходит в результатах поиска: подгружаем для одного выбранного кандидата
        fill_details = getattr(provider, "fill_details", None)
        if fill_details and is_empty(item.genres):
            try:
                candidate = fill_details(candidate)
            except (httpx.HTTPError, ProviderError) as e:
                report.errors.append(f"{label}: детали кандидата не получены — {e}")

        poster_path = None
        if is_empty(item.poster_url) and candidate.poster_url and not dry_run:
            try:
                content, content_type = download(candidate.poster_url)
                poster_path = save_poster(item.id, content, content_type)
            except (httpx.HTTPError, ProviderError, PosterError) as e:
                report.errors.append(f"{label}: постер не сохранён — {e}")
                candidate = replace(candidate, poster_url=None)  # внешнюю ссылку вместо файла не пишем

        changed = apply_candidate(item, candidate, poster_url=poster_path)
        if dry_run:
            db.rollback()  # изменения были нужны только для отчёта
        elif changed:
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                report.errors.append(f"{label}: запись в базу не удалась — {e}")
                continue

        if changed:
            report.enriched += 1
            log(f"{label}: {', '.join(changed)}")
        else:
            report.unchanged += 1
            log(f"{label}: заполнять нечего")

    return report


def merge_review(path: Path, entries: list[dict], processed_ids: Iterable[int]) -> None:
    """Обновляет файл ручной проверки: записи этого запуска заменяются, остальные сохраняются."""
    processed = set(processed_ids)
    existing = []
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, list):
                existing = loaded
        except json.JSONDecodeError:
            pass  # битый файл заменяем новым
    merged = [e for e in existing if e.get("id") not in processed] + entries
    merged.sort(key=lambda e: e["id"])

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")


def print_report(report: EnrichReport, dry_run: bool) -> None:
    mode = "ПРОВЕРКА (в базу и в media/posters ничего не записано)" if dry_run else "ОБОГАЩЕНИЕ"
    print(f"\n=== {mode} ===")
    print(f"Обогащено: {report.enriched}")
    print(f"Неоднозначно: {report.ambiguous}")
    print(f"Не найдено: {report.not_found}")
    print(f"Без изменений: {report.unchanged}")
    print(f"Ошибок: {len(report.errors)}")
    for error in report.errors:
        print(f"  - {error}")


def main(argv: Optional[list[str]] = None) -> int:
    load_dotenv(ROOT / ".env")

    parser = argparse.ArgumentParser(description="Обогащение карточек Episodio данными из внешних API")
    parser.add_argument("--category", choices=sorted(ALL_CATEGORIES), help="Только эта категория")
    parser.add_argument("--limit", type=int, help="Обработать не больше N записей")
    parser.add_argument("--id", type=int, dest="item_id", help="Обработать одну запись")
    parser.add_argument(
        "--source",
        choices=sorted(cls.source for cls in PROVIDER_CLASSES),
        help="Только этот источник (по умолчанию первый подходящий для категории, у аниме и манги это Shikimori)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Показать результат, ничего не записывая")
    args = parser.parse_args(argv)

    providers, skipped = build_providers(args.category, args.source)
    if not providers:
        for reason in skipped:
            print(reason, file=sys.stderr)
        return 2
    for reason in skipped:
        print(f"Пропущено: {reason}\n", file=sys.stderr)

    # Категорию обслуживает первый подходящий провайдер (порядок PROVIDER_CLASSES); другой выбирается через --source
    by_category: dict = {}
    for provider in providers:
        for category in provider.categories:
            by_category.setdefault(category, provider)
    db = SessionLocal()
    try:
        items = select_items(db, by_category, args.category, args.item_id, args.limit)
        if not items:
            print("Нечего обогащать: подходящих записей без постера или с пустыми полями нет.")
            return 0
        print(f"Записей к обработке: {len(items)}\n")

        try:
            report = run_enrich(
                db,
                items,
                provider_for=lambda item: by_category.get(item.category),
                download=make_downloader(providers),
                dry_run=args.dry_run,
            )
        except ProviderAuthError as e:
            print(e, file=sys.stderr)
            return 2
    finally:
        db.close()
        for provider in providers:
            provider.fetcher.close()

    if report.review and not args.dry_run:
        merge_review(REVIEW_PATH, report.review, report.processed_ids)
    elif not args.dry_run and REVIEW_PATH.exists():
        merge_review(REVIEW_PATH, [], report.processed_ids)  # разобранные записи убираем из файла

    print_report(report, args.dry_run)
    if report.review:
        target = "(в dry-run файл не пишется)" if args.dry_run else f"сохранены в {REVIEW_PATH.relative_to(ROOT)}"
        print(f"\nДля ручного выбора: {len(report.review)} записей {target}")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
