from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
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


class Showcase(Base):
    """Таблица showcases: публичная страница «мой топ» по фильтру. Структура повторяет scripts/schema.sql."""

    __tablename__ = "showcases"

    id = Column(Integer, primary_key=True)
    slug = Column(String(64), nullable=False, unique=True)
    title = Column(String(120), nullable=False)
    category = Column(String(50))
    year = Column(Integer)
    month = Column(Integer)
    max_items = Column(Integer, nullable=False, server_default="8")
    is_public = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())


class AiConversation(Base):
    """Таблица ai_conversations: диалог с «Эпи». Структура повторяет scripts/schema.sql."""

    __tablename__ = "ai_conversations"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False, server_default="Новый диалог")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AiMessage(Base):
    """Таблица ai_messages: сообщение диалога (user, assistant, system или tool)."""

    __tablename__ = "ai_messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    tool_calls = Column(JSONB(none_as_null=True))  # None -> SQL NULL, а не JSON null
    tool_call_id = Column(String(100))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
