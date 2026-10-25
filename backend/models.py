from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.sql import func

from backend.database import Base


class MediaItem(Base):
    """Таблица media_items. Структура повторяет scripts/schema.sql один к одному.

    CHECK-ограничения живут только в базе и здесь не дублируются.
    """

    __tablename__ = "media_items"

    id = Column(Integer, primary_key=True)

    # Основная информация
    title_ru = Column(String(255), nullable=False)
    title_original = Column(String(255))
    category = Column(String(50), nullable=False)
    genres = Column(ARRAY(Text), server_default="{}")
    author = Column(String(255))
    country = Column(String(100))
    release_year = Column(Integer)
    description = Column(Text)

    # Статус
    status = Column(String(50), nullable=False, server_default="planned")

    # Прогресс (NULL = неприменимо или неизвестно)
    current_season = Column(Integer)
    current_episode = Column(Integer)
    current_volume = Column(Integer)
    current_chapter = Column(Integer)

    # Сколько всего (NULL = неизвестно или неприменимо)
    total_episodes = Column(Integer)
    total_chapters = Column(Integer)

    # Озвучка / перевод
    translation = Column(String(255))

    # Оценки и впечатления
    rating = Column(Integer)
    comment = Column(Text)

    # Медиа и ссылки
    poster_url = Column(Text)
    source_link = Column(Text)

    # Импорт
    raw = Column(Text)

    # Служебные поля (в базе их же обновляют триггеры)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )


class ProgressLog(Base):
    """Таблица progress_log: запись о просмотренной серии, прочитанной главе или фильме."""

    __tablename__ = "progress_log"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("media_items.id", ondelete="CASCADE"), nullable=False)
    unit = Column(String(20), nullable=False)  # episode | chapter | movie
    number = Column(Integer, nullable=False)
    logged_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
