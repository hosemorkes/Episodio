"""Тесты AI-компаньона «Эпи»: сессия только для чтения, инструменты, Tavily, агент и эндпоинты диалогов.

Внешние API не вызываются: DeepSeek и Tavily заменены httpx.MockTransport.
"""
import asyncio
import json
import typing

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from backend import database
from backend.ai import agent as agent_module
from backend.ai import tavily, tools
from backend.ai.conversations import last_rows, title_from, to_chat_messages
from backend.models import AiMessage, MediaItem
from backend.schemas import Category, Status
from tests.test_api import create


@pytest.fixture
def readonly_factory(test_engine, monkeypatch):
    """get_readonly_db работает с тестовой базой, а не с рабочей."""
    factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    monkeypatch.setattr(database, "SessionLocal", factory)
    return factory


def run(coro):
    return asyncio.run(coro)


# --- Сессия только для чтения ---

def test_readonly_session_blocks_insert(db, readonly_factory):
    with pytest.raises(DBAPIError):
        with database.get_readonly_db() as ro:
            ro.execute(text("INSERT INTO media_items (title_ru, category) VALUES ('X', 'movie')"))
    assert db.query(MediaItem).count() == 0


def test_readonly_session_blocks_update(client, db, readonly_factory):
    item = create(client, title_ru="Исходное")
    with pytest.raises(DBAPIError):
        with database.get_readonly_db() as ro:
            ro.execute(text("UPDATE media_items SET title_ru = 'Взлом'"))
    db.expire_all()
    assert db.get(MediaItem, item["id"]).title_ru == "Исходное"


def test_readonly_session_blocks_delete(client, db, readonly_factory):
    create(client)
    with pytest.raises(DBAPIError):
        with database.get_readonly_db() as ro:
            ro.execute(text("DELETE FROM media_items"))
    assert db.query(MediaItem).count() == 1


def test_readonly_session_reads(client, readonly_factory):
    create(client, title_ru="Читаемое")
    with database.get_readonly_db() as ro:
        assert ro.execute(text("SELECT title_ru FROM media_items")).scalar() == "Читаемое"


# --- Схемы инструментов ---

def test_tool_schemas_are_valid():
    names = [s["function"]["name"] for s in tools.TOOL_SCHEMAS]
    assert names == ["search_library", "get_user_stats", "search_internet_tavily", "get_catalog_popular"]
    for schema in tools.TOOL_SCHEMAS:
        assert schema["type"] == "function"
        params = schema["function"]["parameters"]
        assert params["type"] == "object"
        assert set(params.get("required", [])) <= set(params["properties"])
        assert schema["function"]["description"]
    json.dumps(tools.TOOL_SCHEMAS)  # уходит в запрос модели


def test_tool_schemas_match_backend_enums():
    assert tools.CATEGORIES == list(typing.get_args(Category))
    assert tools.STATUSES == list(typing.get_args(Status))
    by_name = {s["function"]["name"]: s["function"]["parameters"] for s in tools.TOOL_SCHEMAS}
    assert by_name["search_library"]["properties"]["category"]["enum"] == tools.CATEGORIES
    assert by_name["search_library"]["properties"]["status"]["enum"] == tools.STATUSES
    assert by_name["search_library"]["properties"]["min_rating"]["maximum"] == 10
    assert by_name["search_internet_tavily"]["required"] == ["query"]
    assert by_name["get_catalog_popular"]["required"] == ["category"]


# --- search_library и get_user_stats ---

def seed(client):
    create(client, title_ru="Берсерк", title_original="Berserk", category="manga", genres=["Тёмное фэнтези"], rating=10, status="completed")
    create(client, title_ru="Ван-Пис", category="anime", genres=["Приключения", "Комедия"], rating=9, status="watching")
    create(client, title_ru="Скучное кино", category="movie", genres=[], rating=4, status="dropped")
    create(client, title_ru="Планы", category="anime", genres=[], status="planned")


def test_search_library_filters(client, db):
    seed(client)
    result = tools.search_library(db, min_rating=9)
    assert [i["title"] for i in result["items"]] == ["Берсерк", "Ван-Пис"]  # лучшие по оценке первыми
    assert result["total_found"] == 2

    assert [i["title"] for i in tools.search_library(db, category="anime")["items"]][0] == "Ван-Пис"
    assert [i["title"] for i in tools.search_library(db, status="dropped")["items"]] == ["Скучное кино"]
    assert [i["title"] for i in tools.search_library(db, query="berserk")["items"]] == ["Берсерк"]
    assert [i["title"] for i in tools.search_library(db, query="комедия")["items"]] == ["Ван-Пис"]  # по жанру
    assert tools.search_library(db, query="нет такого")["items"] == []


def test_search_library_limit_and_item_shape(client, db):
    seed(client)
    result = tools.search_library(db, limit=1)
    assert len(result["items"]) == 1 and result["total_found"] == 4
    assert set(result["items"][0]) >= {"id", "title", "category", "status", "rating", "genres", "progress"}


def test_search_library_escapes_wildcards(client, db):
    seed(client)
    assert tools.search_library(db, query="%")["items"] == []


def test_search_library_rejects_unknown_values(db):
    assert "error" in tools.search_library(db, category="video")
    assert "error" in tools.search_library(db, status="done")


def test_get_user_stats(client, db):
    seed(client)
    result = tools.get_user_stats(db)
    assert result["total_items"] == 4
    assert {"genres", "countries", "categories", "statuses", "top_items", "totals"} <= set(result)
    assert {c["name"] for c in result["categories"]} == {"manga", "anime", "movie"}
    json.dumps(result, default=str)


def test_tools_use_readonly_session(client, readonly_factory):
    seed(client)
    out = json.loads(run(tools.execute_tool("search_library", json.dumps({"min_rating": 10}), tools.ToolContext())))
    assert [i["title"] for i in out["items"]] == ["Берсерк"]
    stats_out = json.loads(run(tools.execute_tool("get_user_stats", "{}", tools.ToolContext())))
    assert stats_out["total_items"] == 4


# --- execute_tool: ошибки не роняют диалог ---

def test_execute_tool_unknown_and_bad_arguments():
    ctx = tools.ToolContext()
    assert "error" in json.loads(run(tools.execute_tool("drop_table", "{}", ctx)))
    assert "error" in json.loads(run(tools.execute_tool("search_library", "не json", ctx)))
    assert "error" in json.loads(run(tools.execute_tool("search_library", "[1]", ctx)))
    assert "error" in json.loads(run(tools.execute_tool("search_internet_tavily", "{}", ctx)))


def test_execute_tool_without_tavily_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    out = json.loads(run(tools.execute_tool("search_internet_tavily", '{"query": "аниме 2026"}', tools.ToolContext())))
    assert "TAVILY_API_KEY" in out["error"]


def test_get_catalog_popular_uses_provider():
    class Provider:
        source = "mock"

        def popular(self, category, limit):
            from backend.enrich.base import Candidate

            return [Candidate(source="mock", external_id="1", title="Популярный", year=2026, genres=["драма"], rating=8.1)]

    class Registry:
        def provider_for(self, category, source=None):
            return Provider()

    out = tools.get_catalog_popular(Registry(), "movie")
    assert out["items"][0]["title"] == "Популярный"
    assert "error" in tools.get_catalog_popular(Registry(), "video")


# --- Tavily ---

TAVILY_BODY = {
    "answer": "Сезон выходит в январе.",
    "results": [
        {"title": "Новости", "url": "https://example.com/a", "content": "x" * 900, "score": 0.9},
        {"title": "Без ссылки", "content": "пропускается"},
        {"title": "Второй", "url": "https://example.com/b", "content": "кратко"},
    ],
}


def test_parse_tavily_response():
    parsed = tavily.parse_response(TAVILY_BODY)
    assert parsed["answer"] == "Сезон выходит в январе."
    assert [r["url"] for r in parsed["results"]] == ["https://example.com/a", "https://example.com/b"]
    assert len(parsed["results"][0]["content"]) == tavily.SNIPPET_LIMIT
    assert tavily.parse_response({}) == {"answer": None, "results": []}


def test_tavily_search_request_and_parsing():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(200, json=TAVILY_BODY)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await tavily.search("новости аниме", client, api_key="tvly-key")

    result = run(go())
    assert seen["url"] == "https://api.tavily.com/search"
    assert seen["auth"] == "Bearer tvly-key"
    assert seen["body"]["query"] == "новости аниме"
    assert len(result["results"]) == 2


def test_tavily_http_error_becomes_tool_error():
    def handler(_request):
        return httpx.Response(401, json={"detail": "bad key"})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await tools.execute_tool("search_internet_tavily", '{"query": "q"}', tools.ToolContext(http=client))

    import os

    os.environ["TAVILY_API_KEY"] = "bad"
    try:
        out = json.loads(run(go()))
    finally:
        del os.environ["TAVILY_API_KEY"]
    assert "error" in out


# --- Агент: цикл function calling и стриминг ---

def sse_body(*deltas, finish="stop") -> bytes:
    lines = [f"data: {json.dumps({'choices': [{'delta': d}]})}" for d in deltas]
    lines.append(f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': finish}]})}")
    lines.append("data: [DONE]")
    return ("\n\n".join(lines) + "\n\n").encode()


def settings():
    return agent_module.DeepSeekSettings(api_key="sk-test", base_url="https://deepseek.test", model="deepseek-chat")


def collect(history, handler, ctx=None):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return [e async for e in agent_module.run_agent(history, ctx or tools.ToolContext(), settings(), client)]

    return run(go())


def test_agent_streams_plain_answer():
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, content=sse_body({"content": "При"}, {"content": "вет!"}))

    events = collect([{"role": "user", "content": "Привет"}], handler)
    assert [e["text"] for e in events if e["type"] == "chunk"] == ["При", "вет!"]
    assert events[-1] == {"type": "message", "message": {"role": "assistant", "content": "Привет!"}}
    sent = requests[0]
    assert sent["stream"] is True and sent["model"] == "deepseek-chat" and sent["tools"]
    assert sent["messages"][0]["role"] == "system" and sent["messages"][1]["content"] == "Привет"


def test_agent_runs_tool_then_answers(monkeypatch):
    calls = []

    async def fake_execute(name, arguments, ctx):
        calls.append((name, arguments))
        return '{"items": []}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        if len(bodies) == 1:
            # Имя и аргументы приходят кусками, как у настоящего стрима
            return httpx.Response(
                200,
                content=sse_body(
                    {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "search_library", "arguments": ""}}]},
                    {"tool_calls": [{"index": 0, "function": {"arguments": '{"min_rat'}}]},
                    {"tool_calls": [{"index": 0, "function": {"arguments": 'ing": 9}'}}]},
                    finish="tool_calls",
                ),
            )
        return httpx.Response(200, content=sse_body({"content": "Советую Ван-Пис"}))

    events = collect([{"role": "user", "content": "Что посмотреть?"}], handler)
    assert calls == [("search_library", '{"min_rating": 9}')]
    assert [e["name"] for e in events if e["type"] == "tool"] == ["search_library"]
    messages = [e["message"] for e in events if e["type"] == "message"]
    assert [m["role"] for m in messages] == ["assistant", "tool", "assistant"]
    assert messages[0]["tool_calls"][0]["id"] == "call_1"
    assert messages[1]["tool_call_id"] == "call_1"
    assert messages[2]["content"] == "Советую Ван-Пис"
    # Во втором запросе модель видит вызов и результат инструмента
    assert [m["role"] for m in bodies[1]["messages"]] == ["system", "user", "assistant", "tool"]


def test_agent_limits_tool_iterations(monkeypatch):
    async def fake_execute(name, arguments, ctx):
        return "{}"

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        if "tools" in bodies[-1]:
            return httpx.Response(
                200,
                content=sse_body({"tool_calls": [{"index": 0, "id": f"c{len(bodies)}", "function": {"name": "get_user_stats", "arguments": "{}"}}]}, finish="tool_calls"),
            )
        return httpx.Response(200, content=sse_body({"content": "Итог"}))

    events = collect([{"role": "user", "content": "?"}], handler)
    assert len(bodies) == agent_module.MAX_TOOL_ITERATIONS + 1
    assert "tools" not in bodies[-1]  # последний запрос без инструментов: модель обязана ответить
    assert events[-1]["message"]["content"] == "Итог"


def test_agent_http_error_propagates():
    def handler(_request):
        return httpx.Response(401, json={"error": "bad key"})

    with pytest.raises(httpx.HTTPStatusError):
        collect([{"role": "user", "content": "?"}], handler)


def test_settings_from_env(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(agent_module.AgentConfigError):
        agent_module.DeepSeekSettings.from_env()
    monkeypatch.setenv("DEEPSEEK_API_KEY", " sk-1 ")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://x.test/")
    s = agent_module.DeepSeekSettings.from_env()
    assert (s.api_key, s.url, s.model) == ("sk-1", "https://x.test/chat/completions", "deepseek-chat")


def test_system_prompt_is_read_only_and_mentions_recommendation_flow():
    prompt = agent_module.SYSTEM_PROMPT
    assert "Ctrl+K" in prompt and "min_rating=9" in prompt and "get_catalog_popular" in prompt


# --- История и эндпоинты ---

def test_title_from():
    assert title_from("  Что   посмотреть?  ") == "Что посмотреть?"
    assert len(title_from("а" * 200)) == 60


def test_to_chat_messages_drops_orphan_tool_rows():
    rows = [
        AiMessage(role="tool", content="{}", tool_call_id="c1"),
        AiMessage(role="assistant", content="хвост"),
        AiMessage(role="user", content="вопрос"),
        AiMessage(role="assistant", content="", tool_calls=[{"id": "c2"}]),
        AiMessage(role="tool", content="{}", tool_call_id="c2"),
    ]
    messages = to_chat_messages(rows)
    assert [m["role"] for m in messages] == ["user", "assistant", "tool"]
    assert messages[1]["tool_calls"] == [{"id": "c2"}] and messages[2]["tool_call_id"] == "c2"


def test_conversations_crud(client):
    assert client.get("/ai/conversations").json() == []
    first = client.post("/ai/conversations")
    assert first.status_code == 201 and first.json()["title"] == "Новый диалог"
    second = client.post("/ai/conversations", json={"title": "Про аниме"}).json()
    ids = [c["id"] for c in client.get("/ai/conversations").json()]
    assert ids == [second["id"], first.json()["id"]]
    assert client.get(f"/ai/conversations/{second['id']}/messages").json() == []
    assert client.get("/ai/conversations/999/messages").status_code == 404
    assert client.post("/ai/conversations/999/messages", json={"content": "привет"}).status_code in (404, 503)


@pytest.fixture
def stream_env(client, test_engine, monkeypatch):
    """Эндпоинт сообщений с подменённым агентом и сессией стриминга на тестовой базе."""
    import backend.main as main

    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    monkeypatch.setattr(main, "SessionLocal", sessionmaker(bind=test_engine, autocommit=False, autoflush=False))
    return main


def fake_agent(events):
    async def run_fake(history, ctx, settings=None, client=None):
        for event in events:
            yield event

    return run_fake


def parse_sse(body: str) -> list:
    return [json.loads(p[5:]) if p[5:].strip() != "[DONE]" else "[DONE]" for p in body.strip().split("\n\n")]


def test_send_message_streams_and_saves(client, db, stream_env, monkeypatch):
    conv = client.post("/ai/conversations").json()
    tool_call = {"id": "c1", "type": "function", "function": {"name": "get_user_stats", "arguments": "{}"}}
    monkeypatch.setattr(
        stream_env,
        "run_agent",
        fake_agent(
            [
                {"type": "tool", "name": "get_user_stats"},
                {"type": "message", "message": {"role": "assistant", "content": "", "tool_calls": [tool_call]}},
                {"type": "message", "message": {"role": "tool", "tool_call_id": "c1", "content": '{"total_items": 3}'}},
                {"type": "chunk", "text": "Привет"},
                {"type": "chunk", "text": ", мир"},
                {"type": "message", "message": {"role": "assistant", "content": "Привет, мир"}},
            ]
        ),
    )
    response = client.post(f"/ai/conversations/{conv['id']}/messages", json={"content": "Что посмотреть под чак-чак?"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert parse_sse(response.text) == [{"tool": "get_user_stats"}, {"chunk": "Привет"}, {"chunk": ", мир"}, "[DONE]"]

    db.expire_all()
    saved = db.query(AiMessage).order_by(AiMessage.id).all()
    assert [m.role for m in saved] == ["user", "assistant", "tool", "assistant"]
    assert saved[1].tool_calls[0]["id"] == "c1" and saved[2].tool_call_id == "c1"
    assert saved[3].content == "Привет, мир"

    # Название диалога взято из первой реплики; в истории для интерфейса нет служебных сообщений
    assert client.get("/ai/conversations").json()[0]["title"] == "Что посмотреть под чак-чак?"
    visible = client.get(f"/ai/conversations/{conv['id']}/messages").json()
    assert [(m["role"], m["content"]) for m in visible] == [("user", "Что посмотреть под чак-чак?"), ("assistant", "Привет, мир")]


def test_send_message_reports_upstream_error(client, db, stream_env, monkeypatch):
    conv = client.post("/ai/conversations").json()

    async def broken(history, ctx, settings=None, client=None):
        raise httpx.HTTPStatusError("x", request=httpx.Request("POST", "https://x"), response=httpx.Response(401))
        yield  # noqa: unreachable — делает функцию генератором

    monkeypatch.setattr(stream_env, "run_agent", broken)
    response = client.post(f"/ai/conversations/{conv['id']}/messages", json={"content": "привет"})
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert "ключ" in events[0]["error"] and events[-1] == "[DONE]"
    db.expire_all()
    assert [m.role for m in db.query(AiMessage).all()] == ["user"]  # реплика пользователя сохранена, ответа нет


def test_send_message_without_deepseek_key(client, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    conv = client.post("/ai/conversations").json()
    response = client.post(f"/ai/conversations/{conv['id']}/messages", json={"content": "привет"})
    assert response.status_code == 503


def test_send_message_validation_and_404(client, stream_env):
    conv = client.post("/ai/conversations").json()
    assert client.post(f"/ai/conversations/{conv['id']}/messages", json={"content": "   "}).status_code == 422
    assert client.post("/ai/conversations/999/messages", json={"content": "привет"}).status_code == 404


def test_history_limit_is_30(client, db):
    conv = client.post("/ai/conversations").json()
    for i in range(35):
        db.add(AiMessage(conversation_id=conv["id"], role="user", content=f"m{i}"))
    db.commit()
    messages = client.get(f"/ai/conversations/{conv['id']}/messages").json()
    assert len(messages) == 30 and messages[0]["content"] == "m5" and messages[-1]["content"] == "m34"
    assert len(last_rows(db, conv["id"])) == 30


def test_ai_endpoints_require_api_key(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/ai/conversations").status_code == 401
    assert client.get("/ai/conversations", headers={"X-API-Key": "secret"}).status_code == 200
