"""Статистика: распределения по библиотеке и активность по журналу progress_log."""
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from backend.models import MediaItem, ProgressLog
from backend.progress import CHAPTER_CATEGORIES, EPISODE_CATEGORIES

DEFAULT_DAYS = 7
MAX_DAYS = 366

EPISODES = sorted(EPISODE_CATEGORIES)
CHAPTERS = sorted(CHAPTER_CATEGORIES)


class PeriodError(ValueError):
    """Период задан неверно (начало позже конца или слишком длинный)."""


def resolve_period(start: Optional[date], end: Optional[date], today: Optional[date] = None) -> tuple[date, date]:
    """Период по умолчанию: последние 7 дней по сегодня включительно. Границы входят в период."""
    end = end or today or date.today()
    start = start or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise PeriodError("Начало периода позже его конца")
    if (end - start).days + 1 > MAX_DAYS:
        raise PeriodError(f"Период не длиннее {MAX_DAYS} дней")
    return start, end


def progress_expr():
    """Единицы прогресса записи: серии, главы или 1 за просмотренный фильм (у остальных 0)."""
    return case(
        (MediaItem.category.in_(EPISODES), func.coalesce(MediaItem.current_episode, 0)),
        (MediaItem.category.in_(CHAPTERS), func.coalesce(MediaItem.current_chapter, 0)),
        (MediaItem.category == "movie", case((MediaItem.status == "completed", 1), else_=0)),
        else_=0,
    )


def _distribution(db: Session, name, limit: Optional[int], *, skip_empty: bool = False) -> list[dict]:
    progress = func.coalesce(func.sum(progress_expr()), 0)
    items = func.count()
    query = select(name.label("name"), items.label("items"), progress.label("progress")).where(name.is_not(None))
    if skip_empty:
        query = query.where(name != "")
    query = query.group_by(name).order_by(items.desc(), progress.desc(), name)
    if limit:
        query = query.limit(limit)
    return [{"name": r.name, "items": r.items, "progress": int(r.progress)} for r in db.execute(query)]


def _genres(db: Session, limit: int) -> list[dict]:
    # unnest превращает массив жанров в строки: запись с тремя жанрами попадает в три группы
    sub = select(func.unnest(MediaItem.genres).label("name"), progress_expr().label("progress")).subquery()
    progress = func.coalesce(func.sum(sub.c.progress), 0)
    items = func.count()
    query = (
        select(sub.c.name, items.label("items"), progress.label("progress"))
        .where(sub.c.name != "")
        .group_by(sub.c.name)
        .order_by(items.desc(), progress.desc(), sub.c.name)
        .limit(limit)
    )
    return [{"name": r.name, "items": r.items, "progress": int(r.progress)} for r in db.execute(query)]


def _years(db: Session) -> list[dict]:
    progress = func.coalesce(func.sum(progress_expr()), 0)
    query = (
        select(MediaItem.release_year.label("year"), func.count().label("items"), progress.label("progress"))
        .where(MediaItem.release_year.is_not(None))
        .group_by(MediaItem.release_year)
        .order_by(MediaItem.release_year)
    )
    return [{"year": r.year, "items": r.items, "progress": int(r.progress)} for r in db.execute(query)]


def _top_items(db: Session, limit: int) -> list[dict]:
    progress = progress_expr()
    query = (
        select(MediaItem.id, MediaItem.title_ru, MediaItem.title_original, MediaItem.category, progress.label("progress"))
        .where(progress > 0)
        .order_by(progress.desc(), MediaItem.title_ru, MediaItem.id)
        .limit(limit)
    )
    return [
        {"item_id": r.id, "title_ru": r.title_ru, "title_original": r.title_original, "category": r.category, "progress": int(r.progress)}
        for r in db.execute(query)
    ]


def _totals(db: Session) -> dict:
    row = db.execute(
        select(
            func.coalesce(func.sum(case((MediaItem.category.in_(EPISODES), func.coalesce(MediaItem.current_episode, 0)), else_=0)), 0),
            func.coalesce(func.sum(case((MediaItem.category.in_(CHAPTERS), func.coalesce(MediaItem.current_chapter, 0)), else_=0)), 0),
            func.coalesce(func.sum(case(((MediaItem.category == "movie") & (MediaItem.status == "completed"), 1), else_=0)), 0),
        )
    ).one()
    return {"episodes": int(row[0]), "chapters": int(row[1]), "movies": int(row[2])}


def _journal(db: Session, start: date, end: date) -> tuple[list[dict], dict]:
    """Отметки журнала за период: по дням (каждый день периода, пустые = 0) и по видам."""
    since = datetime.combine(start, time.min)
    until = datetime.combine(end + timedelta(days=1), time.min)
    in_period = (ProgressLog.logged_at >= since) & (ProgressLog.logged_at < until)

    day = cast(ProgressLog.logged_at, Date)
    per_day = {r[0]: r[1] for r in db.execute(select(day, func.count()).where(in_period).group_by(day))}
    activity = [
        {"date": start + timedelta(days=i), "count": per_day.get(start + timedelta(days=i), 0)}
        for i in range((end - start).days + 1)
    ]

    per_unit = {r[0]: r[1] for r in db.execute(select(ProgressLog.unit, func.count()).where(in_period).group_by(ProgressLog.unit))}
    marks = {"episodes": per_unit.get("episode", 0), "chapters": per_unit.get("chapter", 0), "movies": per_unit.get("movie", 0)}
    return activity, marks


def build_stats(db: Session, start: Optional[date] = None, end: Optional[date] = None, limit: int = 10) -> dict:
    """Все данные экрана «Статистика» и графика «Эта неделя» одним ответом."""
    start, end = resolve_period(start, end)
    activity, marks = _journal(db, start, end)
    return {
        "period_from": start,
        "period_to": end,
        "total_items": db.scalar(select(func.count()).select_from(MediaItem)) or 0,
        "genres": _genres(db, limit),
        "countries": _distribution(db, MediaItem.country, limit, skip_empty=True),
        "categories": _distribution(db, MediaItem.category, None),
        "statuses": _distribution(db, MediaItem.status, None),
        "years": _years(db),
        "top_items": _top_items(db, limit),
        "totals": _totals(db),
        "activity": activity,
        "marks": marks,
    }
