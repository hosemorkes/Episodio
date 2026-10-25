"""Тесты постеров. Папка постеров подменяется на временную, media/posters не затрагивается."""
import pytest

from backend import posters
from backend.posters import MAX_SIZE, PosterError, delete_poster, save_poster

PNG = b"\x89PNG\r\n\x1a\n" + b"png-data"
JPG = b"\xff\xd8\xff\xe0" + b"jpg-data"
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"webp-data"


@pytest.fixture
def posters_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTERS_DIR", tmp_path)
    return tmp_path


def names(directory):
    return sorted(path.name for path in directory.iterdir())


def create_item(client):
    response = client.post("/items/", json={"title_ru": "Дюна", "category": "book"})
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, item_id, content=PNG, content_type="image/png", filename="poster"):
    return client.post(f"/items/{item_id}/poster", files={"file": (filename, content, content_type)})


# --- backend/posters.py (без БД) ---

def test_save_poster_returns_url_and_writes_file(posters_dir):
    assert save_poster(42, JPG, "image/jpeg") == "/posters/42.jpg"
    assert (posters_dir / "42.jpg").read_bytes() == JPG


@pytest.mark.parametrize(
    "content, content_type, name",
    [(JPG, "image/jpeg", "7.jpg"), (PNG, "image/png", "7.png"), (WEBP, "image/webp", "7.webp")],
)
def test_save_poster_supports_all_types(posters_dir, content, content_type, name):
    assert save_poster(7, content, content_type) == f"/posters/{name}"
    assert names(posters_dir) == [name]


def test_save_poster_removes_old_file_with_other_extension(posters_dir):
    save_poster(1, JPG, "image/jpeg")
    save_poster(1, PNG, "image/png")
    assert names(posters_dir) == ["1.png"]


def test_save_poster_overwrites_same_extension(posters_dir):
    save_poster(1, PNG, "image/png")
    save_poster(1, PNG + b"new", "image/png")
    assert (posters_dir / "1.png").read_bytes() == PNG + b"new"
    assert names(posters_dir) == ["1.png"]


def test_save_poster_creates_missing_directory(tmp_path, monkeypatch):
    target = tmp_path / "nested" / "posters"
    monkeypatch.setattr(posters, "POSTERS_DIR", target)
    save_poster(1, PNG, "image/png")
    assert names(target) == ["1.png"]


def test_save_poster_accepts_content_type_with_parameters(posters_dir):
    assert save_poster(1, PNG, "Image/PNG; charset=binary") == "/posters/1.png"


def test_save_poster_rejects_wrong_type(posters_dir):
    with pytest.raises(PosterError, match="Недопустимый тип файла"):
        save_poster(1, b"hello", "text/plain")
    assert names(posters_dir) == []


def test_save_poster_rejects_too_large(posters_dir):
    with pytest.raises(PosterError, match="5 МБ"):
        save_poster(1, PNG + b"0" * MAX_SIZE, "image/png")
    assert names(posters_dir) == []


def test_save_poster_accepts_exactly_max_size(posters_dir):
    save_poster(1, PNG + b"0" * (MAX_SIZE - len(PNG)), "image/png")
    assert names(posters_dir) == ["1.png"]


def test_save_poster_rejects_empty_file(posters_dir):
    with pytest.raises(PosterError, match="пустой"):
        save_poster(1, b"", "image/png")


def test_save_poster_rejects_content_that_is_not_an_image(posters_dir):
    with pytest.raises(PosterError, match="не похоже"):
        save_poster(1, b"<html>not an image</html>", "image/png")
    assert names(posters_dir) == []


def test_failed_replacement_keeps_old_poster(posters_dir):
    save_poster(1, JPG, "image/jpeg")
    with pytest.raises(PosterError):
        save_poster(1, b"text", "image/png")
    assert names(posters_dir) == ["1.jpg"]


def test_delete_poster_removes_only_this_item(posters_dir):
    save_poster(1, PNG, "image/png")
    save_poster(10, PNG, "image/png")
    delete_poster(1)
    assert names(posters_dir) == ["10.png"]


def test_delete_poster_without_file_is_ok(posters_dir):
    delete_poster(123)


# --- эндпоинты (тестовая БД) ---

def test_upload_png(client, posters_dir):
    item = create_item(client)
    response = upload(client, item["id"])

    assert response.status_code == 200, response.text
    assert response.json()["poster_url"] == f"/posters/{item['id']}.png"
    assert (posters_dir / f"{item['id']}.png").read_bytes() == PNG
    assert client.get(f"/items/{item['id']}").json()["poster_url"] == f"/posters/{item['id']}.png"


def test_upload_rejects_text_plain(client, posters_dir):
    item = create_item(client)
    response = upload(client, item["id"], b"hello", "text/plain", "notes.txt")

    assert response.status_code == 400
    assert "Недопустимый тип файла" in response.json()["detail"]
    assert names(posters_dir) == []
    assert client.get(f"/items/{item['id']}").json()["poster_url"] is None


def test_upload_rejects_file_over_5mb(client, posters_dir):
    item = create_item(client)
    response = upload(client, item["id"], PNG + b"0" * MAX_SIZE)

    assert response.status_code == 400
    assert "5 МБ" in response.json()["detail"]
    assert names(posters_dir) == []
    assert client.get(f"/items/{item['id']}").json()["poster_url"] is None


def test_upload_accepts_file_of_exactly_5mb(client, posters_dir):
    item = create_item(client)
    response = upload(client, item["id"], PNG + b"0" * (MAX_SIZE - len(PNG)))
    assert response.status_code == 200


def test_upload_rejects_fake_image(client, posters_dir):
    item = create_item(client)
    response = upload(client, item["id"], b"not an image", "image/png")
    assert response.status_code == 400
    assert names(posters_dir) == []


def test_upload_for_missing_item_returns_404(client, posters_dir):
    response = upload(client, 999)
    assert response.status_code == 404
    assert names(posters_dir) == []


def test_replacing_jpg_with_png_leaves_no_old_file(client, posters_dir):
    item = create_item(client)
    assert upload(client, item["id"], JPG, "image/jpeg").json()["poster_url"] == f"/posters/{item['id']}.jpg"

    response = upload(client, item["id"], PNG, "image/png")

    assert response.json()["poster_url"] == f"/posters/{item['id']}.png"
    assert names(posters_dir) == [f"{item['id']}.png"]


def test_delete_poster_endpoint(client, posters_dir):
    item = create_item(client)
    upload(client, item["id"])

    response = client.delete(f"/items/{item['id']}/poster")

    assert response.status_code == 200
    assert response.json()["poster_url"] is None
    assert names(posters_dir) == []
    assert client.get(f"/items/{item['id']}").json()["poster_url"] is None


def test_delete_poster_for_missing_item_returns_404(client, posters_dir):
    assert client.delete("/items/999/poster").status_code == 404


def test_deleting_item_deletes_poster_file(client, posters_dir):
    item = create_item(client)
    other = create_item(client)
    upload(client, item["id"])
    upload(client, other["id"])

    assert client.delete(f"/items/{item['id']}").status_code == 204

    assert names(posters_dir) == [f"{other['id']}.png"]


def test_external_poster_url_is_still_allowed(client, posters_dir):
    item = create_item(client)
    url = "https://example.com/poster.jpg"

    response = client.patch(f"/items/{item['id']}", json={"poster_url": url})

    assert response.status_code == 200
    assert response.json()["poster_url"] == url
    assert client.delete(f"/items/{item['id']}").status_code == 204
