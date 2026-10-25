import { describe, expect, it } from "vitest";
import { config } from "@/proxy";
import { guardDecision, isPublicPath } from "./guard";

const re = new RegExp(`^${config.matcher[0]}$`);

describe("guardDecision", () => {
  it("прокси /api/backend/* без сессии: 401", () => {
    for (const p of ["/api/backend/items/", "/api/backend/posters/1.jpg", "/api/backend/health", "/api/me"]) {
      expect(guardDecision(p, "", false)).toEqual({ action: "unauthorized" });
    }
  });
  it("прокси /api/backend/* с сессией проходит", () => {
    expect(guardDecision("/api/backend/items/", "?limit=1", true)).toEqual({ action: "next" });
  });
  it("страница без сессии: на /login, путь запоминается в next", () => {
    expect(guardDecision("/feed", "", false)).toEqual({ action: "redirect", to: "/login?next=%2Ffeed" });
    expect(guardDecision("/title/5", "?a=1", false)).toEqual({ action: "redirect", to: "/login?next=%2Ftitle%2F5%3Fa%3D1" });
  });
  it("главная без сессии: на /login без next", () => {
    expect(guardDecision("/", "", false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("/login: без сессии показывается, с сессией — на главную", () => {
    expect(guardDecision("/login", "", false)).toEqual({ action: "next" });
    expect(guardDecision("/login", "", true)).toEqual({ action: "redirect", to: "/" });
  });
});

describe("публичные витрины", () => {
  it("страница и постер витрины открыты без входа", () => {
    for (const p of ["/u/me/top-anime-2026-03", "/u/me/top-all", "/u/my_name/abc/", "/u/me/top-all/poster/42.jpg", "/u/me/top-all/poster/a-b_c.1.png"]) {
      expect(isPublicPath(p)).toBe(true);
      expect(guardDecision(p, "", false)).toEqual({ action: "next" });
    }
  });
  it("всё остальное под /u/ закрыто сессией", () => {
    const closed = [
      "/u", "/u/", "/u/me", "/u/me/", "/u/me/x/y", "/u/me/top-all/poster", "/u/me/top-all/poster/", "/u/me/top-all/poster/a/b.png",
      "/u/me/Top-All", "/u/me/top_all", "/u/me/-top", "/u/me/top-", "/u/me/top--x", "/u/ME/top", "/u/me/top-all/other/1.jpg",
      "/u/me/top-all/poster/a b.png", "/uu/me/top", "/api/u/me/top", "/x/u/me/top", "/u/" + "a".repeat(33) + "/top",
    ];
    for (const p of closed) {
      expect(isPublicPath(p), p).toBe(false);
      expect(guardDecision(p, "", false).action, p).not.toBe("next");
    }
  });
  it("публичное исключение не открывает прокси и API", () => {
    expect(guardDecision("/api/backend/showcases", "", false)).toEqual({ action: "unauthorized" });
    expect(guardDecision("/api/backend/public/showcases/x", "", false)).toEqual({ action: "unauthorized" });
    expect(guardDecision("/showcase", "", false).action).toBe("redirect"); // управление витринами только с входом
  });
  it("matcher пропускает публичные адреса в гард (решение принимает guardDecision)", () => {
    expect(re.test("/u/me/top-all")).toBe(true);
  });
});

describe("matcher гарда (src/proxy.ts)", () => {

  it("закрывает прокси к FastAPI и страницы", () => {
    for (const p of ["/api/backend/items/", "/api/backend/posters/1.jpg", "/api/me", "/", "/feed", "/login"]) expect(re.test(p)).toBe(true);
  });
  it("оставляет открытыми вход, служебные файлы Next и PWA", () => {
    for (const p of ["/api/auth/login", "/api/auth/logout", "/_next/static/a.js", "/manifest.webmanifest", "/sw.js", "/favicon.ico", "/icons/icon-192.png"]) {
      expect(re.test(p)).toBe(false);
    }
  });
});
