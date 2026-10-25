"""Хранение постеров: файлы лежат в media/posters/{id}.{jpg|png|webp}, в БД — только путь /posters/{id}.ext."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTERS_DIR = ROOT / "media" / "posters"
URL_PREFIX = "/posters"

MAX_SIZE = 5 * 1024 * 1024  # 5 МБ

# content-type -> расширение файла
EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class PosterError(ValueError):
    """Файл не подходит в качестве постера. Текст ошибки можно показывать пользователю."""


def _matches_signature(content: bytes, extension: str) -> bool:
    """Проверяет начало файла, чтобы под видом image/png нельзя было загрузить произвольный файл."""
    if extension == "jpg":
        return content.startswith(b"\xff\xd8\xff")
    if extension == "png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if extension == "webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return False


def _poster_path(item_id: int, extension: str) -> Path:
    return POSTERS_DIR / f"{item_id}.{extension}"


def save_poster(item_id: int, content: bytes, content_type: str) -> str:
    """Сохраняет постер записи и возвращает путь вида /posters/{item_id}.jpg.

    Старый постер этой записи с другим расширением удаляется. При ошибке бросает PosterError.
    """
    content_type = (content_type or "").split(";")[0].strip().lower()
    extension = EXTENSIONS.get(content_type)
    if extension is None:
        raise PosterError(
            f"Недопустимый тип файла: {content_type or 'не указан'}. "
            f"Разрешены: {', '.join(EXTENSIONS)}"
        )
    if not content:
        raise PosterError("Файл пустой")
    if len(content) > MAX_SIZE:
        raise PosterError(f"Файл больше {MAX_SIZE // (1024 * 1024)} МБ")
    if not _matches_signature(content, extension):
        raise PosterError(f"Содержимое файла не похоже на {content_type}")

    POSTERS_DIR.mkdir(parents=True, exist_ok=True)
    target = _poster_path(item_id, extension)
    # Сначала пишем во временный файл: при сбое старый постер не пропадёт
    temp = target.with_name(target.name + ".tmp")
    temp.write_bytes(content)
    os.replace(temp, target)

    for other in EXTENSIONS.values():
        if other != extension:
            _poster_path(item_id, other).unlink(missing_ok=True)
    return f"{URL_PREFIX}/{target.name}"


def delete_poster(item_id: int) -> None:
    """Удаляет файлы постера записи (если они есть)."""
    for extension in EXTENSIONS.values():
        _poster_path(item_id, extension).unlink(missing_ok=True)
