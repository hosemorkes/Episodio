import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { changedText, enrichErrorInfo, gapsOf, needsReview, sourceName, sourcesFor } from "./enrich";
import type { Title } from "./types";

const t = (s: string) => s;

const full = (over: Partial<Title> = {}): Title => ({
  id: 1,
  type: "series",
  st: "watching",
  t: "Медведь",
  y: 2022,
  c: "США",
  g: ["Драма"],
  ep: 2,
  tot: 8,
  img: "/api/backend/posters/1.jpg",
  h: [10, 50],
  ...over,
});

describe("gapsOf / needsReview", () => {
  it("полная карточка проверки не требует", () => {
    expect(gapsOf(full())).toEqual([]);
    expect(needsReview(full())).toBe(false);
  });
  it("находит все пробелы в порядке показа", () => {
    expect(gapsOf(full({ img: undefined, g: [], c: "—", y: 0 }))).toEqual(["poster", "genres", "country", "year"]);
  });
  it("каждое поле по отдельности", () => {
    expect(gapsOf(full({ img: undefined }))).toEqual(["poster"]);
    expect(gapsOf(full({ g: [] }))).toEqual(["genres"]);
    expect(gapsOf(full({ c: "—" }))).toEqual(["country"]);
    expect(gapsOf(full({ c: "" }))).toEqual(["country"]);
    expect(gapsOf(full({ y: 0 }))).toEqual(["year"]);
  });
  it("автор и оценка не считаются пробелом", () => {
    expect(needsReview(full({ author: undefined, rate: 0 }))).toBe(false);
  });
});

describe("sourceName", () => {
  it("известные источники красиво, неизвестные как есть", () => {
    expect(sourceName("tmdb")).toBe("TMDB");
    expect(sourceName("shikimori")).toBe("Shikimori");
    expect(sourceName("openlibrary")).toBe("Open Library");
    expect(sourceName("anilist")).toBe("AniList");
    expect(sourceName("kitsu")).toBe("kitsu");
  });
});

describe("sourcesFor", () => {
  it("у аниме и манги два источника, первый по умолчанию", () => {
    expect(sourcesFor("anime")).toEqual(["shikimori", "anilist"]);
    expect(sourcesFor("manga")).toEqual(["shikimori", "anilist"]);
  });
  it("у остальных типов выбирать нечего", () => {
    for (const t of ["series", "movie", "show", "cartoon", "book", "audiobook"] as const) expect(sourcesFor(t)).toEqual([]);
  });
});

describe("changedText", () => {
  it("перечисляет заполненные поля", () => {
    expect(changedText(["poster_url", "genres", "release_year"], t)).toBe("Заполнено: постер, жанры, год");
  });
  it("пустой список — сообщение, что нового нет", () => {
    expect(changedText([], t)).toBe("Новых данных нет: всё уже заполнено");
  });
  it("неизвестное поле показывается как есть", () => {
    expect(changedText(["foo"], t)).toBe("Заполнено: foo");
  });
});

describe("enrichErrorInfo", () => {
  it("текст берётся из ответа сервера", () => {
    expect(enrichErrorInfo(new ApiError(503, "Обогащение недоступно: нет ключа")).message).toBe("Обогащение недоступно: нет ключа");
  });
  it("400 и 503 повтором не лечатся", () => {
    expect(enrichErrorInfo(new ApiError(400, "x"))).toMatchObject({ retry: false, reload: false });
    expect(enrichErrorInfo(new ApiError(503, "x"))).toMatchObject({ retry: false, reload: false });
  });
  it("502, 504 и обрыв связи можно повторить", () => {
    for (const s of [0, 502, 504]) expect(enrichErrorInfo(new ApiError(s, "x"))).toMatchObject({ retry: true, reload: false });
  });
  it("404: нужно обновить список вариантов", () => {
    expect(enrichErrorInfo(new ApiError(404, "Кандидат не найден"))).toMatchObject({ retry: true, reload: true });
  });
  it("не ApiError: общее сообщение и повтор", () => {
    expect(enrichErrorInfo(new Error("boom"))).toEqual({ message: "Не удалось выполнить действие", retry: true, reload: false });
  });
});
