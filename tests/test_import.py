"""Тесты импорта: to_item и dedup_key — без базы, import_records и main — на тестовой PostgreSQL."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.models import MediaItem
from scripts import import_json
from scripts.import_json import dedup_key, import_records, to_item

SAMPLE = Path(__file__).parent / "fixtures" / "media_sample.json"

# Ожидаемый итог импорта media_sample.json
EXPECTED_TOTAL = 10
EXPECTED_ADDED = {"tv_series": 2, "anime": 1, "manga": 1, "movie": 1, "book": 1, "cartoon": 1}
EXPECTED_DUPLICATES = 1
EXPECTED_ERROR_INDEXES = {7, 8}  # неизвестная категория и пустой title_ru


def sample_records():
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))
    return [(SAMPLE.name, index, record) for index, record in enumerate(data, start=1)]


def imported(db):
    return {item.title_ru: item for item in db.query(MediaItem)}


# --- to_item (без БД) ---

def test_to_item_renames_progress_fields():
    item = to_item({"title_ru": "Дюна", "category": "book", "volume": 2, "chapter": 5})
    assert (item.current_volume, item.current_chapter) == (2, 5)
    assert item.current_season is None
    assert item.current_episode is None

    item = to_item({"title_ru": "Сериал", "category": "tv_series", "season": 7, "episode": 12})
    assert (item.current_season, item.current_episode) == (7, 12)


def test_to_item_empty_strings_become_none():
    item = to_item({"title_ru": " Дюна ", "title_original": "", "translation": "   ", "category": "book"})
    assert item.title_ru == "Дюна"
    assert item.title_original is None
    assert item.translation is None


def test_to_item_normalizes_genres():
    item = to_item({"title_ru": "X", "category": "movie", "genres": ["Драма", "драма", " комедия "]})
    assert item.genres == ["драма", "комедия"]


def test_to_item_without_genres():
    assert to_item({"title_ru": "X", "category": "movie"}).genres == []
    assert to_item({"title_ru": "X", "category": "movie", "genres": None}).genres == []


def test_to_item_drops_status():
    item = to_item({"title_ru": "X", "category": "movie", "status": "completed"})
    assert item.status == "planned"


def test_to_item_ignores_unknown_keys():
    item = to_item({"title_ru": "X", "category": "movie", "unknown_field": "?"})
    assert item.title_ru == "X"
    assert not hasattr(item, "unknown_field")


@pytest.mark.parametrize(
    "record",
    [
        {"title_ru": "X", "category": "serial"},
        {"title_ru": "", "category": "movie"},
        {"category": "movie"},
        {"title_ru": "X", "category": "movie", "rating": 11},
        {"title_ru": "X", "category": "movie", "season": -1},
        {"title_ru": "X", "category": "movie", "genres": "драма"},
    ],
)
def test_to_item_rejects_invalid_records(record):
    with pytest.raises(ValidationError):
        to_item(record)


# --- dedup_key (без БД) ---

def test_dedup_key_ignores_case():
    assert dedup_key("Дюна", "Dune", "book") == dedup_key("ДЮНА", "dune", "book")


def test_dedup_key_distinguishes_category_and_original():
    assert dedup_key("Дюна", "Dune", "book") != dedup_key("Дюна", "Dune", "movie")
    assert dedup_key("Дюна", "Dune", "book") != dedup_key("Дюна", None, "book")


def test_dedup_key_treats_missing_original_as_empty():
    assert dedup_key("Дюна", None, "book") == dedup_key("Дюна", "", "book")


# --- import_records (тестовая БД) ---

def test_import_report_counts(db):
    report = import_records(db, sample_records())

    assert report.total == EXPECTED_TOTAL
    assert dict(report.added) == EXPECTED_ADDED
    assert report.added_total == sum(EXPECTED_ADDED.values())
    assert report.duplicates == EXPECTED_DUPLICATES
    assert {error.index for error in report.errors} == EXPECTED_ERROR_INDEXES
    assert db.query(MediaItem).count() == report.added_total


def test_import_errors_have_index_raw_and_field(db):
    report = import_records(db, sample_records())
    errors = {error.index: error for error in report.errors}

    assert errors[7].raw == "неизвестная категория serial"
    assert errors[7].field == "category"
    assert errors[8].raw == "пустое русское название"
    assert errors[8].field == "title_ru"
    assert "#7 [неизвестная категория serial]: category" in str(errors[7])


def test_all_imported_items_are_planned(db):
    import_records(db, sample_records())
    items = imported(db)

    assert len(items) == 7
    assert {item.status for item in items.values()} == {"planned"}
    # запись со status "completed" тоже стала planned
    assert items["Во все тяжкие"].status == "planned"


def test_movie_has_null_progress(db):
    import_records(db, sample_records())
    movie = imported(db)["Начало"]

    assert movie.category == "movie"
    assert movie.current_season is None
    assert movie.current_episode is None
    assert movie.current_volume is None
    assert movie.current_chapter is None


def test_manga_has_volume_and_chapter(db):
    import_records(db, sample_records())
    manga = imported(db)["Берсерк"]

    assert (manga.current_volume, manga.current_chapter) == (41, 364)
    assert manga.current_season is None
    assert manga.current_episode is None


def test_series_and_anime_fields(db):
    import_records(db, sample_records())
    items = imported(db)

    series = items["Блудливая Калифорния"]
    assert (series.current_season, series.current_episode) == (7, 12)
    assert series.genres == ["драма", "комедия"]
    assert series.raw == "Californication  7 сезон 12 серия"

    assert items["Атака титанов"].translation == "AniLibria"


def test_duplicate_keeps_first_record(db):
    import_records(db, sample_records())
    series = imported(db)["Блудливая Калифорния"]

    # дубль (season 1, episode 1) не должен перезаписать первую запись
    assert (series.current_season, series.current_episode) == (7, 12)
    assert db.query(MediaItem).filter(MediaItem.title_original.ilike("californication")).count() == 1


def test_genres_are_normalized_in_db(db):
    import_records(db, sample_records())
    assert imported(db)["Мастер и Маргарита"].genres == ["драма", "комедия"]


def test_empty_original_title_is_null_in_db(db):
    import_records(db, sample_records())
    assert imported(db)["Мастер и Маргарита"].title_original is None


def test_unknown_field_is_ignored(db):
    report = import_records(db, sample_records())
    assert "Ходячий замок" in imported(db)
    assert all(error.index != 9 for error in report.errors)


def test_rerun_adds_nothing(db):
    first = import_records(db, sample_records())
    second = import_records(db, sample_records())

    assert second.added_total == 0
    assert second.duplicates == first.added_total + first.duplicates
    assert len(second.errors) == len(first.errors)
    assert db.query(MediaItem).count() == first.added_total


def test_dry_run_writes_nothing(db):
    report = import_records(db, sample_records(), dry_run=True)

    assert report.added_total == sum(EXPECTED_ADDED.values())
    assert report.duplicates == EXPECTED_DUPLICATES
    assert len(report.errors) == len(EXPECTED_ERROR_INDEXES)
    assert db.query(MediaItem).count() == 0


def test_dry_run_then_real_import(db):
    import_records(db, sample_records(), dry_run=True)
    report = import_records(db, sample_records())
    assert report.added_total == sum(EXPECTED_ADDED.values())
    assert db.query(MediaItem).count() == report.added_total


def test_import_continues_after_error(db):
    records = [
        ("f.json", 1, {"title_ru": "Плохая", "category": "serial"}),
        ("f.json", 2, {"title_ru": "Хорошая", "category": "movie"}),
        ("f.json", 3, "не объект"),
    ]
    report = import_records(db, records)

    assert report.added_total == 1
    assert len(report.errors) == 2
    assert "не является объектом" in report.errors[1].message
    assert list(imported(db)) == ["Хорошая"]


# --- main: код возврата и отчёт (сессию подменяем на тестовую) ---

@pytest.fixture
def cli(db, monkeypatch):
    class NoCloseSession:
        """main() закрывает сессию, а фикстура db ещё нужна тесту."""

        def __getattr__(self, name):
            return getattr(db, name)

        def close(self):
            pass

    monkeypatch.setattr(import_json, "SessionLocal", lambda: NoCloseSession())
    return import_json.main


def test_main_returns_1_when_errors(cli, capsys):
    assert cli([str(SAMPLE)]) == 1
    out = capsys.readouterr().out
    assert "Ошибок: 2" in out
    assert "неизвестная категория serial" in out


def test_main_dry_run_report(cli, db, capsys):
    cli([str(SAMPLE), "--dry-run"])
    out = capsys.readouterr().out

    assert "ПРОВЕРКА" in out
    assert "Будет добавлено: 7" in out
    assert db.query(MediaItem).count() == 0


def test_main_returns_0_without_errors(cli, tmp_path):
    path = tmp_path / "ok.json"
    path.write_text(json.dumps([{"title_ru": "Дюна", "category": "book"}], ensure_ascii=False), encoding="utf-8")
    assert cli([str(path)]) == 0


def test_main_accepts_several_files(cli, tmp_path, db):
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    first.write_text(json.dumps([{"title_ru": "Один", "category": "movie"}]), encoding="utf-8")
    second.write_text(json.dumps([{"title_ru": "Два", "category": "movie"}]), encoding="utf-8")

    assert cli([str(first), str(second)]) == 0
    assert db.query(MediaItem).count() == 2


def test_load_records_rejects_non_array(tmp_path):
    path = tmp_path / "obj.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        import_json.load_records([str(path)])
    assert "ожидался JSON-массив" in str(exc.value)
