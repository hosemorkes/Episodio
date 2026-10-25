"""Тесты Pydantic-схем (без базы данных)."""
import pytest
from pydantic import ValidationError

from backend.schemas import MediaItemCreate, MediaItemUpdate


def valid_record(**overrides):
    data = {
        "title_ru": "Блудливая Калифорния",
        "title_original": "Californication",
        "category": "tv_series",
        "genres": ["драма", "комедия"],
        "country": "США",
        "release_year": 2007,
        "current_season": 7,
        "current_episode": 12,
    }
    data.update(overrides)
    return data


def test_valid_record_passes():
    item = MediaItemCreate(**valid_record())
    assert item.title_ru == "Блудливая Калифорния"
    assert item.status == "planned"
    assert item.current_volume is None
    assert item.current_chapter is None


def test_progress_defaults_to_none():
    item = MediaItemCreate(title_ru="Дюна", category="book")
    assert item.current_season is None
    assert item.current_episode is None
    assert item.genres == []


def test_invalid_category():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(category="podcast"))


def test_invalid_status():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(status="finished"))


def test_rating_above_range():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(rating=11))


def test_rating_below_range():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(rating=0))


def test_negative_episode():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(current_episode=-1))


def test_empty_title():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(title_ru=""))


def test_new_fields_default_to_none():
    item = MediaItemCreate(title_ru="Дюна", category="book")
    assert item.description is None
    assert item.total_episodes is None
    assert item.total_chapters is None


def test_negative_total_rejected():
    with pytest.raises(ValidationError):
        MediaItemCreate(**valid_record(total_chapters=-1))
    with pytest.raises(ValidationError):
        MediaItemUpdate(total_episodes=-1)


def test_genres_lowercased_without_blanks_and_duplicates():
    item = MediaItemCreate(**valid_record(genres=[" Экшен ", "драма", "ДРАМА", ""]))
    assert item.genres == ["экшен", "драма"]


def test_update_genres_lowercased_and_empty_list_kept():
    assert MediaItemUpdate(genres=["Драма"]).genres == ["драма"]
    assert MediaItemUpdate(genres=[]).model_dump(exclude_unset=True) == {"genres": []}


def test_finished_at_is_not_writable():
    item = MediaItemCreate(**valid_record(finished_at="2026-01-01T00:00:00"))
    assert not hasattr(item, "finished_at")


def test_update_without_fields_is_empty():
    assert MediaItemUpdate().model_dump(exclude_unset=True) == {}


def test_update_keeps_only_passed_fields():
    update = MediaItemUpdate(current_episode=6)
    assert update.model_dump(exclude_unset=True) == {"current_episode": 6}


def test_update_validates_fields():
    with pytest.raises(ValidationError):
        MediaItemUpdate(rating=11)
