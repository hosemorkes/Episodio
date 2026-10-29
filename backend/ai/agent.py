"""Агент «Эпи»: цикл function calling поверх DeepSeek (OpenAI-совместимый API) со стримингом ответа.

Агент ничего не знает о базе диалогов: принимает историю в формате чат-API и отдаёт события —
куски текста, начало вызова инструмента и готовые сообщения, которые вызывающий код сохраняет.
"""
import json
import os
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import httpx

from backend.ai.tools import TOOL_SCHEMAS, ToolContext, execute_tool

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
MAX_TOOL_ITERATIONS = 4
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

SYSTEM_PROMPT = """Ты — «Эпи», AI-компаньон личного трекера Episodio. Ты увлечённый, дружелюбный и эрудированный гик: \
живо болтаешь про аниме, кино, сериалы, мультфильмы, мангу, книги и аудиокниги. Отвечай по-русски, тепло и по делу, \
без воды; можно немного эмоций и шуток.

Правила:
- Ты только информируешь и советуешь. Менять библиотеку ты не можешь. Если просят изменить статус, оценку, прогресс или \
добавить тайтл — вежливо объясни, как сделать это самому: открыть карточку или нажать Ctrl+K (командная палитра) и добавить \
тайтл через поиск по каталогам.
- Данные о пользователе бери только из инструментов, ничего не выдумывай. Если инструмент вернул ошибку или пусто, \
скажи об этом честно.
- Для свежих новостей, дат релизов и фактов, в которых не уверен, используй веб-поиск.
- Не предлагай то, что у пользователя уже завершено или брошено, если он не просит этого явно.
- Пиши простым текстом без Markdown-разметки (без звёздочек, решёток и таблиц); для списков используй «•» с новой строки.
- Тема разговора — медиа и вкусы. Совсем посторонние вопросы вежливо возвращай к кино, аниме и книгам.
- Формат разговора — юмористически, но сдержанно, без абсурда, не много с черным юмором.

Как рекомендовать («Что посмотреть под чак-чак?» и подобное): сначала найди любимое пользователя через search_library \
с min_rating=9, посмотри общую статистику вкусов через get_user_stats, сверься с популярным в каталогах через \
get_catalog_popular и затем посоветуй один-три тайтла с аргументацией, почему они зайдут именно этому пользователю \
(жанры, настроение, похожие любимые тайтлы). Учитывай ситуацию из вопроса: «под чак-чак» — это лёгкое, весёлое, \
без перегруза сюжетом."""


class AgentConfigError(Exception):
    """DeepSeek не настроен (нет DEEPSEEK_API_KEY)."""


@dataclass
class DeepSeekSettings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL

    @classmethod
    def from_env(cls) -> "DeepSeekSettings":
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            raise AgentConfigError("Эпи недоступна: задайте DEEPSEEK_API_KEY в .env")
        return cls(
            api_key=api_key,
            base_url=(os.getenv("DEEPSEEK_BASE_URL", "").strip() or DEFAULT_BASE_URL).rstrip("/"),
            model=os.getenv("DEEPSEEK_MODEL", "").strip() or DEFAULT_MODEL,
        )

    @property
    def url(self) -> str:
        return f"{self.base_url}/chat/completions"


# События агента: {"type": "chunk", "text"} — кусок ответа; {"type": "tool", "name"} — модель вызвала инструмент;
# {"type": "message", "message"} — завершённое сообщение (assistant с tool_calls, tool или финальный ответ) для сохранения
AgentEvent = dict


async def _stream_completion(
    client: httpx.AsyncClient,
    settings: DeepSeekSettings,
    messages: list[dict],
    with_tools: bool,
) -> AsyncIterator[dict]:
    """Один запрос к модели в режиме stream=True. Отдаёт {"text"} по мере прихода и в конце {"done", "content", "tool_calls"}."""
    payload: dict = {"model": settings.model, "messages": messages, "stream": True}
    if with_tools:
        payload["tools"] = TOOL_SCHEMAS
    headers = {"Authorization": f"Bearer {settings.api_key}"}

    content = ""
    calls: dict[int, dict] = {}  # index -> {"id", "name", "arguments"}: аргументы приходят кусками
    async with client.stream("POST", settings.url, json=payload, headers=headers) as response:
        if response.status_code >= 400:
            await response.aread()
            response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                choices = json.loads(data).get("choices") or []
            except ValueError:
                continue
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if delta.get("content"):
                content += delta["content"]
                yield {"text": delta["content"]}
            for part in delta.get("tool_calls") or []:
                call = calls.setdefault(part.get("index", 0), {"id": "", "name": "", "arguments": ""})
                call["id"] = part.get("id") or call["id"]
                function = part.get("function") or {}
                call["name"] += function.get("name") or ""
                call["arguments"] += function.get("arguments") or ""

    tool_calls = [
        {"id": c["id"] or f"call_{i}", "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
        for i, c in sorted(calls.items())
        if c["name"]
    ]
    yield {"done": True, "content": content, "tool_calls": tool_calls}


async def run_agent(
    history: list[dict],
    ctx: ToolContext,
    settings: Optional[DeepSeekSettings] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> AsyncIterator[AgentEvent]:
    """Ведёт ход диалога. history — сообщения чат-API (user/assistant/tool), системный промпт добавляется здесь.

    Цикл: запрос к модели со стримингом; если она вызвала инструменты — выполняем их и повторяем (не больше
    MAX_TOOL_ITERATIONS раз); после лимита просим ответить без инструментов. Текст ответа идёт чанками сразу.
    """
    settings = settings or DeepSeekSettings.from_env()
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]
    try:
        for iteration in range(MAX_TOOL_ITERATIONS + 1):
            with_tools = iteration < MAX_TOOL_ITERATIONS
            content, tool_calls = "", []
            async for part in _stream_completion(client, settings, messages, with_tools):
                if "text" in part:
                    yield {"type": "chunk", "text": part["text"]}
                else:
                    content, tool_calls = part["content"], part["tool_calls"]

            if not tool_calls or not with_tools:
                yield {"type": "message", "message": {"role": "assistant", "content": content}}
                return

            # Сообщения вызова и результатов отдаём подряд после выполнения всех инструментов: пара не рвётся
            assistant = {"role": "assistant", "content": content, "tool_calls": tool_calls}
            results = []
            for call in tool_calls:
                name = call["function"]["name"]
                yield {"type": "tool", "name": name}
                output = await execute_tool(name, call["function"]["arguments"], ctx)
                results.append({"role": "tool", "tool_call_id": call["id"], "content": output})
            messages += [assistant, *results]
            for message in (assistant, *results):
                yield {"type": "message", "message": message}
    finally:
        if own_client:
            await client.aclose()
