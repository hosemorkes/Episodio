"""Тесты scripts/backup.py: pg_dump подменяется заглушкой, база не нужна."""
import subprocess
from datetime import datetime

import pytest
from sqlalchemy.engine import URL

from scripts import backup

SECRET = "s3cr3t-pass"
URL_ = URL.create("postgresql+psycopg2", username="episodio", password=SECRET, host="db.local", port=5433, database="episodio_db")


@pytest.fixture
def fake_exe(tmp_path):
    exe = tmp_path / "pg_dump.exe"
    exe.write_text("")
    return str(exe)


@pytest.fixture(autouse=True)
def fixed_url(monkeypatch):
    monkeypatch.setattr(backup, "get_database_url", lambda: URL_)


def touch_backups(directory, stamps):
    directory.mkdir(parents=True, exist_ok=True)
    for s in stamps:
        (directory / f"{backup.PREFIX}{s}{backup.SUFFIX}").write_text("x")


def fake_run(calls, returncode=0, stderr=""):
    """Заглушка subprocess.run: «pg_dump» создаёт файл, указанный после --file."""

    def run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        if returncode == 0:
            out = cmd[cmd.index("--file") + 1]
            open(out, "w").write("dump")
        return subprocess.CompletedProcess(cmd, returncode, "", stderr)

    return run


def test_rotate_keeps_newest(tmp_path):
    touch_backups(tmp_path, ["20260101_000000", "20260102_000000", "20260103_000000", "20260104_000000"])
    (tmp_path / "notes.txt").write_text("не копия")
    removed = backup.rotate(tmp_path, keep=2)
    assert [p.name for p in removed] == ["episodio_20260101_000000.dump", "episodio_20260102_000000.dump"]
    assert [p.name for p in backup.backup_files(tmp_path)] == ["episodio_20260103_000000.dump", "episodio_20260104_000000.dump"]
    assert (tmp_path / "notes.txt").exists()


def test_rotate_fewer_than_keep_removes_nothing(tmp_path):
    touch_backups(tmp_path, ["20260101_000000"])
    assert backup.rotate(tmp_path, keep=14) == []
    assert len(backup.backup_files(tmp_path)) == 1


def test_command_has_no_password(tmp_path):
    cmd = backup.build_command("pg_dump", URL_, tmp_path / "out.dump")
    assert SECRET not in " ".join(cmd)
    assert cmd[cmd.index("--host") + 1] == "db.local"
    assert cmd[cmd.index("--port") + 1] == "5433"
    assert cmd[cmd.index("--username") + 1] == "episodio"
    assert cmd[cmd.index("--dbname") + 1] == "episodio_db"


def test_make_backup_creates_file_and_rotates(tmp_path, fake_exe, monkeypatch):
    directory = tmp_path / "backups"
    touch_backups(directory, ["20250101_000000", "20250102_000000"])
    calls = []
    monkeypatch.setattr(backup.subprocess, "run", fake_run(calls))

    target = backup.make_backup(directory, keep=2, pg_dump=fake_exe, now=datetime(2026, 10, 25, 3, 0, 0))

    assert target.name == "episodio_20261025_030000.dump"
    assert target.read_text() == "dump"
    assert not list(directory.glob("*.partial"))
    # осталось две последних: старые удалены только после успешной копии
    assert [p.name for p in backup.backup_files(directory)] == ["episodio_20250102_000000.dump", "episodio_20261025_030000.dump"]
    cmd, kwargs = calls[0]
    assert SECRET not in " ".join(cmd)
    assert kwargs["env"]["PGPASSWORD"] == SECRET


def test_failed_dump_keeps_old_backups_and_hides_password(tmp_path, fake_exe, monkeypatch):
    directory = tmp_path / "backups"
    touch_backups(directory, ["20250101_000000", "20250102_000000"])
    monkeypatch.setattr(backup.subprocess, "run", fake_run([], returncode=1, stderr="pg_dump: error: connection failed"))

    with pytest.raises(backup.BackupError) as e:
        backup.make_backup(directory, keep=1, pg_dump=fake_exe)

    assert "connection failed" in str(e.value)
    assert SECRET not in str(e.value)
    assert len(backup.backup_files(directory)) == 2
    assert not list(directory.glob("*.partial"))


def test_keep_must_be_positive(tmp_path, fake_exe):
    with pytest.raises(backup.BackupError):
        backup.make_backup(tmp_path, keep=0, pg_dump=fake_exe)


def test_find_pg_dump_explicit_path(fake_exe, tmp_path):
    assert backup.find_pg_dump(fake_exe) == fake_exe
    with pytest.raises(backup.BackupError):
        backup.find_pg_dump(str(tmp_path / "нет.exe"))


def test_find_pg_dump_missing_everywhere(monkeypatch):
    monkeypatch.delenv("PG_DUMP", raising=False)
    monkeypatch.setattr(backup.shutil, "which", lambda _: None)
    monkeypatch.delenv("ProgramFiles", raising=False)
    monkeypatch.delenv("ProgramFiles(x86)", raising=False)
    with pytest.raises(backup.BackupError, match="pg_dump не найден"):
        backup.find_pg_dump()


def test_find_pg_dump_prefers_newest_installation(tmp_path, monkeypatch):
    for v in ("9.6", "16", "18"):
        exe = tmp_path / "PostgreSQL" / v / "bin" / "pg_dump.exe"
        exe.parent.mkdir(parents=True)
        exe.write_text("")
    monkeypatch.delenv("PG_DUMP", raising=False)
    monkeypatch.setattr(backup.shutil, "which", lambda _: None)
    monkeypatch.setenv("ProgramFiles", str(tmp_path))
    monkeypatch.delenv("ProgramFiles(x86)", raising=False)
    assert backup.find_pg_dump().replace("\\", "/").endswith("PostgreSQL/18/bin/pg_dump.exe")


def test_main_prints_result_without_password(tmp_path, fake_exe, monkeypatch, capsys):
    monkeypatch.setattr(backup.subprocess, "run", fake_run([]))
    code = backup.main(["--dir", str(tmp_path / "b"), "--keep", "3", "--pg-dump", fake_exe])
    out = capsys.readouterr().out
    assert code == 0
    assert "episodio_db" in out and SECRET not in out


def test_main_reports_error_with_exit_code_1(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("PG_DUMP", raising=False)
    monkeypatch.setattr(backup.shutil, "which", lambda _: None)
    monkeypatch.delenv("ProgramFiles", raising=False)
    monkeypatch.delenv("ProgramFiles(x86)", raising=False)
    assert backup.main(["--dir", str(tmp_path)]) == 1
    assert "Ошибка" in capsys.readouterr().err
