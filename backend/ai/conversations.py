"""История диалогов с «Эпи» в БД: сохранение сообщений, сборка контекста для модели, формат SSE."""
import json
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.models import AiConversation, AiMessage

HISTORY_LIMIT = 30
DEFAULT_TITLE = "Новый диалог"
TITLE_LIMIT = 60


def sse(payload: dict) -> str:
    """Одно событие SSE: data: {...}"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


SSE_DONE = "data: [DONE]\n\n"


def title_from(text: str) -> str:
    """Название диалога по первой реплике: первая строка, не длиннее TITLE_LIMIT символов."""
    line = " ".join(text.split())
    return line if len(line) <= TITLE_LIMIT else line[: TITLE_LIMIT - 1].rstrip() + "…"


def add_message(db: Session, conversation: AiConversation, message: dict) -> AiMessage:
    """Сохраняет сообщение в формате чат-API ({role, content, tool_calls?, tool_call_id?}) и обновляет диалог."""
    row = AiMessage(
        conversation_id=conversation.id,
        role=message["role"],
        content=message.get("content") or "",
        tool_calls=message.get("tool_calls"),
        tool_call_id=message.get("tool_call_id"),
    )
    db.add(row)
    conversation.updated_at = func.now()
    # Первая реплика пользователя даёт название диалога
    if message["role"] == "user" and conversation.title == DEFAULT_TITLE:
        conversation.title = title_from(row.content)
    db.commit()
    return row


def last_rows(db: Session, conversation_id: int, limit: int = HISTORY_LIMIT, visible_only: bool = False) -> list[AiMessage]:
    """Последние limit сообщений диалога в хронологическом порядке.

    visible_only — только реплики пользователя и ответы ассистента (без вызовов инструментов): то, что показывает интерфейс.
    """
    query = select(AiMessage).where(AiMessage.conversation_id == conversation_id)
    if visible_only:
        query = query.where(AiMessage.role.in_(("user", "assistant")), AiMessage.tool_calls.is_(None), AiMessage.content != "")
    rows = db.scalars(query.order_by(AiMessage.id.desc()).limit(limit)).all()
    return list(reversed(rows))


def to_chat_messages(rows: list[AiMessage]) -> list[dict]:
    """Строки БД -> сообщения чат-API. Начало истории подрезается до первой реплики пользователя:
    «осиротевшие» ответы инструментов без вызова модель не принимает.
    """
    start = next((i for i, r in enumerate(rows) if r.role == "user"), len(rows))
    messages: list[dict] = []
    for row in rows[start:]:
        if row.role == "system":
            continue  # системный промпт задаёт агент
        message: dict = {"role": row.role, "content": row.content}
        if row.tool_calls:
            message["tool_calls"] = row.tool_calls
        if row.tool_call_id:
            message["tool_call_id"] = row.tool_call_id
        messages.append(message)
    return messages


def get_conversation(db: Session, conversation_id: int) -> Optional[AiConversation]:
    return db.get(AiConversation, conversation_id)
