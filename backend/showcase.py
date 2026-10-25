"""Витрины: публичные страницы «мой топ» по фильтру (категория, год и месяц завершения).

Управление витринами (/showcases) закрыто ключом API, как и всё остальное. Публичный ответ собирается из явного списка полей
(to_item): заметка, ссылка на источник, озвучка, raw и внутренние id в него не попадают. Витрина видна только при is_public,
несуществующая и отключённая отвечают одинаково (404), чтобы адрес нельзя было использовать для проверки существования.
"""
import re
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from backend import posters
from backend.database import get_db
from backend.models import MediaItem, Showcase
from backend.schemas import (
    ShowcaseCreate,
    ShowcaseFilter,
    ShowcaseItem,
    ShowcaseResponse,
    ShowcaseUpdate,
    ShowcaseView,
)

router = APIRouter()

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
POSTER_PREFIX = "/posters/"
POSTER_MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


# --- выборка ---

def select_items(db: Session, category: Optional[str], year: Optional[int], month: Optional[int], max_items: int) -> list[MediaItem]:
    """Топ по оценке среди завершённого за период: оценка по убыванию, при равенстве позже завершённые первыми.

    Берутся только записи со статусом completed, оценкой и датой завершения (finished_at); год и месяц считаются
    по finished_at. Без года период не ограничен.
    """
    query = db.query(MediaItem).filter(
        MediaItem.status == "completed", MediaItem.rating.is_not(None), MediaItem.finished_at.is_not(None)
    )
    if category:
        query = query.filter(MediaItem.category == category)
    if year:
        query = query.filter(extract("year", MediaItem.finished_at) == year)
    if month:
        query = query.filter(extract("month", MediaItem.finished_at) == month)
    return query.order_by(MediaItem.rating.desc(), MediaItem.finished_at.desc(), MediaItem.id).limit(max_items).all()


def poster_file(poster_url: Optional[str]) -> Optional[str]:
    """Имя файла локального постера (/posters/42.jpg -> 42.jpg); для внешних адресов и пустого значения None."""
    if poster_url and poster_url.startswith(POSTER_PREFIX):
        name = poster_url[len(POSTER_PREFIX):]
        if name and name == Path(name).name and name not in (".", ".."):
            return name
    return None


def to_item(item: MediaItem, poster: Optional[str]) -> ShowcaseItem:
    """Поля записи, которые разрешено показывать публично. Новые поля сюда попадают только осознанно."""
    finished: Optional[date] = item.finished_at.date() if item.finished_at else None
    return ShowcaseItem(
        title_ru=item.title_ru,
        title_original=item.title_original,
        category=item.category,
        release_year=item.release_year,
        genres=item.genres or [],
        country=item.country,
        author=item.author,
        rating=item.rating,
        poster=poster,
        finished_on=finished,
    )


def build_view(db: Session, title: str, category, year, month, max_items: int, slug: Optional[str] = None) -> ShowcaseView:
    """Содержимое витрины. С slug постеры отдаются публичным адресом витрины, без него (предпросмотр) — как в библиотеке."""
    items = []
    for item in select_items(db, category, year, month, max_items):
        name = poster_file(item.poster_url)
        if name and slug:
            poster = f"/public/showcases/{slug}/posters/{name}"
        elif name:
            poster = item.poster_url
        else:
            # Внешний адрес (http...) отдаётся как есть, любой другой вид пути публично не показываем
            poster = item.poster_url if (item.poster_url or "").startswith(("http://", "https://")) else None
        items.append(to_item(item, poster))
    return ShowcaseView(title=title, category=category, year=year, month=month, items=items)


# --- адрес ---

def auto_slug(db: Session, category: Optional[str], year: Optional[int], month: Optional[int]) -> str:
    """Адрес по параметрам, например top-anime-2026-03; занятый получает суффикс -2, -3…"""
    parts = ["top", (category or "all").replace("_", "-")]
    if year:
        parts.append(str(year))
    if month:
        parts.append(f"{month:02d}")
    base = "-".join(parts)
    slug, n = base, 1
    while db.query(Showcase.id).filter(Showcase.slug == slug).first():
        n += 1
        slug = f"{base}-{n}"
    return slug


def taken(db: Session, slug: str, except_id: Optional[int] = None) -> bool:
    query = db.query(Showcase.id).filter(Showcase.slug == slug)
    if except_id is not None:
        query = query.filter(Showcase.id != except_id)
    return query.first() is not None


def get_or_404(db: Session, showcase_id: int) -> Showcase:
    showcase = db.get(Showcase, showcase_id)
    if showcase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Витрина не найдена")
    return showcase


def public_or_404(db: Session, slug: str) -> Showcase:
    showcase = db.query(Showcase).filter(Showcase.slug == slug, Showcase.is_public.is_(True)).first()
    if showcase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Витрина не найдена")
    return showcase


# --- управление (с ключом API) ---

@router.get("/showcases", response_model=list[ShowcaseResponse])
def list_showcases(db: Session = Depends(get_db)):
    return db.query(Showcase).order_by(Showcase.created_at.desc(), Showcase.id.desc()).all()


@router.post("/showcases", response_model=ShowcaseResponse, status_code=status.HTTP_201_CREATED)
def create_showcase(body: ShowcaseCreate, db: Session = Depends(get_db)):
    slug = body.slug or auto_slug(db, body.category, body.year, body.month)
    if taken(db, slug):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Адрес «{slug}» уже занят")
    showcase = Showcase(
        slug=slug, title=body.title, category=body.category, year=body.year, month=body.month,
        max_items=body.max_items, is_public=body.is_public,
    )
    db.add(showcase)
    db.commit()
    db.refresh(showcase)
    return showcase


@router.patch("/showcases/{showcase_id}", response_model=ShowcaseResponse)
def update_showcase(showcase_id: int, body: ShowcaseUpdate, db: Session = Depends(get_db)):
    showcase = get_or_404(db, showcase_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("title", "max_items", "is_public"):
        if required in changes and changes[required] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Поле «{required}» не может быть пустым")
    if "slug" in changes:
        if changes["slug"] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Поле «slug» не может быть пустым")
        if taken(db, changes["slug"], showcase.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Адрес «{changes['slug']}» уже занят")
    year = changes.get("year", showcase.year)
    month = changes.get("month", showcase.month)
    if month is not None and year is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Месяц задаётся только вместе с годом")
    for name, value in changes.items():
        setattr(showcase, name, value)
    db.commit()
    db.refresh(showcase)
    return showcase


@router.delete("/showcases/{showcase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_showcase(showcase_id: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, showcase_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/showcases/preview", response_model=ShowcaseView)
def preview_showcase(body: ShowcaseFilter, db: Session = Depends(get_db)):
    """Предпросмотр по фильтру, ничего не сохраняя (в том числе для витрины, которая ещё не создана)."""
    return build_view(db, body.title, body.category, body.year, body.month, body.max_items)


# --- публичная часть ---

@router.get("/public/showcases/{slug}", response_model=ShowcaseView)
def public_showcase(slug: str, db: Session = Depends(get_db)):
    showcase = public_or_404(db, slug)
    return build_view(db, showcase.title, showcase.category, showcase.year, showcase.month, showcase.max_items, showcase.slug)


@router.get("/public/showcases/{slug}/posters/{filename}")
def public_showcase_poster(slug: str, filename: str, db: Session = Depends(get_db)):
    """Постер отдаётся, только если он принадлежит записи, которая сейчас входит в эту публичную витрину."""
    showcase = public_or_404(db, slug)
    allowed = {
        poster_file(item.poster_url)
        for item in select_items(db, showcase.category, showcase.year, showcase.month, showcase.max_items)
    }
    media_type = POSTER_MEDIA_TYPES.get(Path(filename).suffix.lower())
    path = posters.POSTERS_DIR / filename
    if filename not in allowed or media_type is None or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Постер не найден")
    return FileResponse(path, media_type=media_type)
