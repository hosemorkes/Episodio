"""Резервная копия БД через pg_dump с ротацией.

Запуск из корня проекта:
    python -m scripts.backup                    # копия в data/backups, хранятся последние 14
    python -m scripts.backup --keep 30          # хранить последние 30
    python -m scripts.backup --dir D:\\Backups   # другая папка
    python -m scripts.backup --pg-dump "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"

Файл копии: episodio_ГГГГММДД_ЧЧММСС.dump (формат custom, восстановление: pg_restore).
Пароль передаётся pg_dump через окружение процесса и нигде не печатается.
Постеры (media/posters) в копию не входят: БД хранит только путь, файлы копируйте отдельно.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy.engine import URL

from backend.database import get_database_url

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = ROOT / "data" / "backups"
DEFAULT_KEEP = 14
PREFIX = "episodio_"
SUFFIX = ".dump"


class BackupError(Exception):
    """Копию создать не удалось (понятное сообщение для пользователя)."""


def version_key(name: str) -> tuple[int, ...]:
    """Версия из имени папки: «18» -> (18,), «9.6» -> (9, 6); без цифр -> (0,)."""
    return tuple(int(n) for n in re.findall(r"\d+", name)) or (0,)


def find_pg_dump(explicit: str | None = None) -> str:
    """Путь к pg_dump: аргумент, переменная PG_DUMP, PATH, затем установки PostgreSQL в Program Files."""
    candidates = [explicit, os.getenv("PG_DUMP")]
    for c in candidates:
        if c:
            if Path(c).is_file():
                return c
            raise BackupError(f"pg_dump не найден по пути: {c}")
    found = shutil.which("pg_dump")
    if found:
        return found
    for base in (os.getenv("ProgramFiles"), os.getenv("ProgramFiles(x86)")):
        if not base:
            continue
        # Новые версии первыми: сортировка по числу в имени папки (9.6 < 16 < 18), а не по строке
        dirs = sorted((Path(base) / "PostgreSQL").glob("*/bin/pg_dump.exe"), key=lambda p: version_key(p.parent.parent.name), reverse=True)
        if dirs:
            return str(dirs[0])
    raise BackupError("pg_dump не найден: добавьте папку bin PostgreSQL в PATH или укажите --pg-dump / переменную PG_DUMP")


def build_command(pg_dump: str, url: URL, out: Path) -> list[str]:
    """Команда pg_dump. Пароль в неё не входит (он идёт через PGPASSWORD), чтобы не светиться в списке процессов."""
    cmd = [pg_dump, "--format=custom", "--no-owner", "--file", str(out)]
    if url.host:
        cmd += ["--host", url.host]
    if url.port:
        cmd += ["--port", str(url.port)]
    if url.username:
        cmd += ["--username", url.username]
    cmd += ["--dbname", url.database or ""]
    return cmd


def backup_files(directory: Path) -> list[Path]:
    """Копии в папке, старые первыми (имя содержит время, поэтому порядок по имени = по времени)."""
    return sorted(p for p in directory.glob(f"{PREFIX}*{SUFFIX}") if p.is_file())


def rotate(directory: Path, keep: int) -> list[Path]:
    """Удаляет все копии, кроме последних keep. Возвращает удалённые файлы."""
    files = backup_files(directory)
    old = files[: max(0, len(files) - keep)]
    for p in old:
        p.unlink()
    return old


def make_backup(directory: Path, keep: int, pg_dump: str | None = None, now: datetime | None = None) -> Path:
    """Создаёт копию в directory и применяет ротацию. Ротация идёт только после успешной копии."""
    if keep < 1:
        raise BackupError("--keep должен быть не меньше 1")
    url = get_database_url()
    exe = find_pg_dump(pg_dump)
    directory.mkdir(parents=True, exist_ok=True)

    stamp = (now or datetime.now()).strftime("%Y%m%d_%H%M%S")
    target = directory / f"{PREFIX}{stamp}{SUFFIX}"
    partial = target.with_name(target.name + ".partial")

    env = os.environ.copy()
    if url.password:
        env["PGPASSWORD"] = url.password
    try:
        result = subprocess.run(build_command(exe, url, partial), env=env, capture_output=True, text=True)
    except OSError as e:
        raise BackupError(f"не удалось запустить pg_dump: {e}") from e
    if result.returncode != 0:
        partial.unlink(missing_ok=True)
        reason = (result.stderr or "").strip().splitlines()
        raise BackupError(f"pg_dump завершился с кодом {result.returncode}: {reason[-1] if reason else 'без сообщения'}")
    partial.replace(target)
    rotate(directory, keep)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Резервная копия БД Episodio (pg_dump с ротацией)")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="папка для копий (по умолчанию data/backups)")
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP, help=f"сколько последних копий хранить (по умолчанию {DEFAULT_KEEP})")
    parser.add_argument("--pg-dump", help="путь к pg_dump, если его нет в PATH")
    args = parser.parse_args(argv)

    url = get_database_url()
    try:
        target = make_backup(args.dir, args.keep, args.pg_dump)
    except BackupError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 1
    size = target.stat().st_size / 1024
    print(f"Копия базы {url.database} ({url.host}): {target} ({size:.0f} КБ). Хранится копий: {len(backup_files(args.dir))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
