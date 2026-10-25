import { describe, expect, it } from "vitest";
import { apiBaseUrl, downstreamHeaders, upstreamHeaders, upstreamUrl } from "./backend-proxy";

const BASE = "http://127.0.0.1:8000";

describe("apiBaseUrl", () => {
  it("по умолчанию локальный uvicorn", () => expect(apiBaseUrl({})).toBe(BASE));
  it("берёт API_URL и убирает завершающие слэши", () => expect(apiBaseUrl({ API_URL: " https://api.example.com// " })).toBe("https://api.example.com"));
  it("пустое значение — по умолчанию", () => expect(apiBaseUrl({ API_URL: "  " })).toBe(BASE));
});

describe("upstreamUrl", () => {
  it("пропускает разрешённые разделы", () => {
    expect(upstreamUrl(BASE, ["items", "7"])).toBe(`${BASE}/items/7`);
    expect(upstreamUrl(BASE, ["items", "7", "progress"])).toBe(`${BASE}/items/7/progress`);
    expect(upstreamUrl(BASE, ["genres"])).toBe(`${BASE}/genres`);
    expect(upstreamUrl(BASE, ["catalog", "search"], "?q=%D0%A4&category=anime")).toBe(`${BASE}/catalog/search?q=%D0%A4&category=anime`);
    expect(upstreamUrl(BASE, ["items", "from-catalog"])).toBe(`${BASE}/items/from-catalog`);
    expect(upstreamUrl(BASE, ["log"], "?limit=20&before=5")).toBe(`${BASE}/log?limit=20&before=5`);
    expect(upstreamUrl(BASE, ["stats"], "?from=2026-10-19&to=2026-10-25")).toBe(`${BASE}/stats?from=2026-10-19&to=2026-10-25`);
    expect(upstreamUrl(BASE, ["posters", "42.jpg"])).toBe(`${BASE}/posters/42.jpg`);
    expect(upstreamUrl(BASE, ["health"])).toBe(`${BASE}/health`);
  });
  it("список и создание: добавляет слэш, чтобы не было редиректа FastAPI", () => {
    expect(upstreamUrl(BASE, ["items"], "?status=watching")).toBe(`${BASE}/items/?status=watching`);
  });
  it("закрывает остальные пути", () => {
    for (const p of [[], ["docs"], ["openapi.json"], ["enrich"], [""]]) expect(upstreamUrl(BASE, p)).toBeNull();
  });
  it("отклоняет выход за пределы API", () => {
    expect(upstreamUrl(BASE, ["items", ".."])).toBeNull();
    expect(upstreamUrl(BASE, ["posters", ".", "x"])).toBeNull();
    expect(upstreamUrl(BASE, ["items", "a/b"])).toBeNull();
    expect(upstreamUrl(BASE, ["items", "a\\b"])).toBeNull();
    expect(upstreamUrl(BASE, ["items", ""])).toBeNull();
  });
  it("кодирует сегменты", () => {
    expect(upstreamUrl(BASE, ["posters", "a b?.jpg"])).toBe(`${BASE}/posters/a%20b%3F.jpg`);
  });
});

describe("upstreamHeaders", () => {
  it("копирует нужное и подставляет ключ", () => {
    const h = upstreamHeaders(new Headers({ "content-type": "application/json", accept: "application/json", cookie: "episodio_session=secret", authorization: "x" }), "k");
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("accept")).toBe("application/json");
    expect(h.get("X-API-Key")).toBe("k");
  });
  it("cookie сессии и прочее в бэкенд не уходит", () => {
    const h = upstreamHeaders(new Headers({ cookie: "episodio_session=secret", authorization: "x", "x-api-key": "from-browser" }), undefined);
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    // ключ из браузера не пробрасываем: его выставляет только сервер
    expect(h.get("x-api-key")).toBeNull();
  });
  it("без ключа в окружении заголовок не ставится", () => {
    expect(upstreamHeaders(new Headers(), "").get("X-API-Key")).toBeNull();
  });
});

describe("downstreamHeaders", () => {
  it("отдаёт тип и заголовки кэша, остальное нет", () => {
    const h = downstreamHeaders(new Headers({ "content-type": "image/jpeg", etag: '"a"', "last-modified": "x", "set-cookie": "a=b", server: "uvicorn" }));
    expect(h.get("content-type")).toBe("image/jpeg");
    expect(h.get("etag")).toBe('"a"');
    expect(h.get("set-cookie")).toBeNull();
    expect(h.get("server")).toBeNull();
  });
});
