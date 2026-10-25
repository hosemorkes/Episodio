"""Прогресс и журнал: отметка серии/главы, откат и запись просмотра фильма."""
from typing import Optional

from sqlalchemy.orm import Session

from backend.models import MediaItem, ProgressLog

# Категории, у которых прогресс считается сериями, и те, у которых главами. У movie прогресса нет
EPISODE_CATEGORIES = {"anime", "cartoon", "tv_series", "tv_show"}
CHAPTER_CATEGORIES = {"manga", "book", "audiobook"}


class ProgressError(Exception):
    """Отметка невозможна (фильм или всё уже отмечено)."""


class NothingToMark(ProgressError):
    """Прогресс уже достиг общего числа серий или глав."""


def unit_fields(category: str) -> Optional[tuple[str, str, str]]:
    """Единица журнала и имена полей (текущее, всего) для категории; None, если прогресса нет."""
    if category in EPISODE_CATEGORIES:
        return "episode", "current_episode", "total_episodes"
    if category in CHAPTER_CATEGORIES:
        return "chapter", "current_chapter", "total_chapters"
    return None


def last_entry(db: Session, item_id: int) -> Optional[ProgressLog]:
    return db.query(ProgressLog).filter(ProgressLog.item_id == item_id).order_by(ProgressLog.id.desc()).first()


def apply_delta(db: Session, item: MediaItem, delta: int) -> Optional[ProgressLog]:
    """Меняет прогресс на ±1 и ведёт журнал. Возвращает созданную (+1) или удалённую (−1) запись.

    +1 пишет в журнал номер новой серии/главы. −1 уменьшает счётчик (не ниже 0) и удаляет
    последнюю запись журнала, если она есть. Статус правится как на фронтенде: последняя серия -> completed,
    начатое из planned/completed -> watching. Коммит делает вызывающий код.
    """
    fields = unit_fields(item.category)
    if fields is None:
        raise ProgressError("У фильма нет прогресса: отметь просмотр сменой статуса на completed")
    unit, current_name, total_name = fields
    current = getattr(item, current_name)
    total = getattr(item, total_name)

    if delta > 0:
        if total is not None and (current or 0) >= total:
            raise NothingToMark("Всё уже отмечено: прогресс достиг общего числа")
        number = (current or 0) + 1
        setattr(item, current_name, number)
        if total is not None and number >= total:
            item.status = "completed"
        elif item.status in ("planned", "completed"):
            item.status = "watching"
        entry = ProgressLog(item_id=item.id, unit=unit, number=number)
        db.add(entry)
        db.flush()
        db.refresh(entry)
        return entry

    if current is not None:
        setattr(item, current_name, max(0, current - 1))
    if item.status == "completed":
        item.status = "watching"
    entry = last_entry(db, item.id)
    if entry is not None:
        db.delete(entry)
        db.flush()
    return entry


def sync_movie_log(db: Session, item: MediaItem, old_status: Optional[str]) -> None:
    """Журнал фильма: переход в completed пишет запись, уход из completed удаляет последнюю.

    old_status=None — запись только что создана. Для других категорий ничего не делает.
    """
    if item.category != "movie" or item.status == old_status:
        return
    if item.status == "completed":
        db.add(ProgressLog(item_id=item.id, unit="movie", number=1))
    elif old_status == "completed":
        entry = last_entry(db, item.id)
        if entry is not None:
            db.delete(entry)
