import { describe, expect, it } from "vitest";
import { config } from "@/proxy";
import { guardDecision } from "./guard";

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

describe("matcher гарда (src/proxy.ts)", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);

  it("закрывает прокси к FastAPI и страницы", () => {
    for (const p of ["/api/backend/items/", "/api/backend/posters/1.jpg", "/api/me", "/", "/feed", "/login"]) expect(re.test(p)).toBe(true);
  });
  it("оставляет открытыми вход, служебные файлы Next и PWA", () => {
    for (const p of ["/api/auth/login", "/api/auth/logout", "/_next/static/a.js", "/manifest.webmanifest", "/sw.js", "/favicon.ico", "/icons/icon-192.png"]) {
      expect(re.test(p)).toBe(false);
    }
  });
});
