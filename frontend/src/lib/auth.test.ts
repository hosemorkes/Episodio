import { describe, expect, it } from "vitest";
import { checkCredentials, createSession, readAuthConfig, safeEqual, verifySession } from "./auth";

const cfg = { login: "Alex", password: "s3cret-pass", secret: "test-secret-0123456789" };

describe("readAuthConfig", () => {
  it("null, если что-то не задано", () => {
    expect(readAuthConfig({ AUTH_LOGIN: "a", AUTH_PASSWORD: "b" })).toBeNull();
    expect(readAuthConfig({})).toBeNull();
  });
  it("читает все три значения", () => {
    expect(readAuthConfig({ AUTH_LOGIN: " a ", AUTH_PASSWORD: "b", AUTH_SECRET: "c" })).toEqual({ login: "a", password: "b", secret: "c" });
  });
});

describe("checkCredentials", () => {
  it("логин без учёта регистра, пароль точно", async () => {
    expect(await checkCredentials(cfg, " alex ", "s3cret-pass")).toBe(true);
    expect(await checkCredentials(cfg, "alex", "S3CRET-pass")).toBe(false);
    expect(await checkCredentials(cfg, "bob", "s3cret-pass")).toBe(false);
  });
});

describe("сессия", () => {
  it("подлинный токен возвращает логин", async () => {
    expect(await verifySession(cfg, await createSession(cfg))).toBe("Alex");
  });
  it("подделанная подпись отклоняется", async () => {
    const token = await createSession(cfg);
    expect(await verifySession(cfg, token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"))).toBeNull();
  });
  it("токен с другим секретом отклоняется", async () => {
    expect(await verifySession({ ...cfg, secret: "other-secret-9999999999" }, await createSession(cfg))).toBeNull();
  });
  it("просроченный токен отклоняется", async () => {
    const past = Date.now() - 40 * 86400_000;
    expect(await verifySession(cfg, await createSession(cfg, 30, past))).toBeNull();
  });
  it("пустой и мусорный токены отклоняются", async () => {
    expect(await verifySession(cfg, undefined)).toBeNull();
    expect(await verifySession(cfg, "a.b")).toBeNull();
  });
});

describe("safeEqual", () => {
  it("сравнивает строки разной длины без ошибок", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
