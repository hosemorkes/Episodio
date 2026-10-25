import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()


def normalize_url(raw_url: str) -> URL:
    """Для адреса postgresql:// явно выбирает драйвер psycopg2 (по умолчанию SQLAlchemy 2.1 ищет psycopg 3)."""
    url = make_url(raw_url)
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg2")
    return url


def get_database_url() -> URL:
    """Строка подключения: DATABASE_URL или, если её нет, сборка из DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME.

    Для отсутствующих значений берутся настройки по умолчанию, как в .env.example.
    """
    raw_url = os.getenv("DATABASE_URL")
    if raw_url:
        return normalize_url(raw_url)
    return URL.create(
        "postgresql+psycopg2",
        username=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "episodio_db"),
    )


engine = create_engine(get_database_url())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
