import { describe, expect, it } from "vitest";
import { DEFAULT_HANDLE, originFrom, publicHandle, publicPosterSrc, upstreamAuth } from "./public-showcase";

describe("publicHandle", () => {
  it("по умолчанию me", () => {
    expect(publicHandle({})).toBe(DEFAULT_HANDLE);
    expect(publicHandle({ PUBLIC_HANDLE: "  " })).toBe("me");
  });
  it("берёт PUBLIC_HANDLE и приводит к нижнему регистру", () => {
    expect(publicHandle({ PUBLIC_HANDLE: " Alex_01 " })).toBe("alex_01");
    expect(publicHandle({ PUBLIC_HANDLE: "my-name" })).toBe("my-name");
  });
  it("неверное значение заменяется именем по умолчанию, а не попадает в ссылку", () => {
    for (const bad of ["a/b", "имя", "x y", "a".repeat(33), "../x", "a.b"]) expect(publicHandle({ PUBLIC_HANDLE: bad })).toBe("me");
  });
});

describe("publicPosterSrc", () => {
  it("локальный постер витрины идёт через маршрут страницы", () => {
    expect(publicPosterSrc("me", "top-all", "/public/showcases/top-all/posters/42.jpg")).toBe("/u/me/top-all/poster/42.jpg");
  });
  it("внешний https-адрес остаётся как есть", () => {
    expect(publicPosterSrc("me", "top-all", "https://image.tmdb.org/t/p/w500/x.jpg")).toBe("https://image.tmdb.org/t/p/w500/x.jpg");
  });
  it("пусто, чужой путь, чужая витрина, опасный файл и не-http адрес не показываются", () => {
    expect(publicPosterSrc("me", "top-all", null)).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "/posters/42.jpg")).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "/public/showcases/other/posters/42.jpg")).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "/public/showcases/top-all/posters/a/b.jpg")).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "/public/showcases/top-all/posters/x y.jpg")).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "javascript:alert(1)")).toBeUndefined();
    expect(publicPosterSrc("me", "top-all", "file:///etc/passwd")).toBeUndefined();
  });
});

describe("originFrom", () => {
  const h = (map: Record<string, string>) => (name: string) => map[name] ?? null;
  it("localhost без прокси — http", () => expect(originFrom(h({ host: "localhost:3000" }))).toBe("http://localhost:3000"));
  it("обычный домен — https", () => expect(originFrom(h({ host: "episodio.example.com" }))).toBe("https://episodio.example.com"));
  it("за обратным прокси берутся x-forwarded-*", () => {
    expect(originFrom(h({ host: "127.0.0.1:3000", "x-forwarded-host": "shows.example.com", "x-forwarded-proto": "https" }))).toBe("https://shows.example.com");
    expect(originFrom(h({ host: "x", "x-forwarded-host": "a.example.com, b.example.com", "x-forwarded-proto": "https, http" }))).toBe("https://a.example.com");
  });
  it("нечитаемый или опасный host заменяется безопасным", () => {
    expect(originFrom(h({ host: "evil.example/<script>" }))).toBe("http://localhost:3000");
    expect(originFrom(h({}))).toBe("http://localhost:3000");
  });
  it("протокол, отличный от http, считается https", () => {
    expect(originFrom(h({ host: "a.example.com", "x-forwarded-proto": "javascript" }))).toBe("https://a.example.com");
  });
});

describe("upstreamAuth", () => {
  it("ключ API в заголовке, пустой ключ — без заголовка", () => {
    expect(upstreamAuth({ API_KEY: " secret " })).toEqual({ "X-API-Key": "secret" });
    expect(upstreamAuth({})).toEqual({});
    expect(upstreamAuth({ API_KEY: "  " })).toEqual({});
  });
});
