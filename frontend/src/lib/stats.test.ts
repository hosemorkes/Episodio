import { describe, expect, it } from "vitest";
import { isStatsEmpty, libraryBreakdown, ratingBreakdown, totalsOf, watchHours, weekCounts, weekRange, yearBars, ymd } from "./stats";
import type { Stats, Title } from "./types";

const title = (over: Partial<Title> = {}): Title => ({
  id: 1,
  type: "series",
  st: "watching",
  t: "Т",
  y: 2020,
  c: "США",
  g: [],
  ep: 0,
  tot: 0,
  h: [0, 0],
  ...over,
});

const stats = (over: Partial<Stats> = {}): Stats => ({
  from: "2026-10-19",
  to: "2026-10-25",
  totalItems: 0,
  genres: [],
  countries: [],
  years: [],
  top: [],
  totals: { episodes: 0, chapters: 0, movies: 0 },
  activity: [],
  marks: { episodes: 0, chapters: 0, movies: 0 },
  ...over,
});

describe("ymd", () => {
  it("локальная дата с ведущими нулями", () => {
    expect(ymd(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("weekRange", () => {
  it("среда: неделя с понедельника по воскресенье, сегодня — индекс 2", () => {
    expect(weekRange(new Date(2026, 9, 21))).toEqual({ from: "2026-10-19", to: "2026-10-25", todayIdx: 2 });
  });
  it("понедельник — начало недели, воскресенье — конец (индекс 6)", () => {
    expect(weekRange(new Date(2026, 9, 19))).toMatchObject({ from: "2026-10-19", todayIdx: 0 });
    expect(weekRange(new Date(2026, 9, 25))).toEqual({ from: "2026-10-19", to: "2026-10-25", todayIdx: 6 });
  });
  it("переход через месяц и год", () => {
    expect(weekRange(new Date(2026, 10, 1))).toMatchObject({ from: "2026-10-26", to: "2026-11-01", todayIdx: 6 });
    expect(weekRange(new Date(2026, 0, 1))).toMatchObject({ from: "2025-12-29", to: "2026-01-04", todayIdx: 3 });
  });
});

describe("weekCounts", () => {
  it("раскладывает отметки по дням Пн..Вс, недостающие дни — нули", () => {
    const activity = [
      { date: "2026-10-19", count: 2 },
      { date: "2026-10-21", count: 5 },
      { date: "2026-10-25", count: 1 },
    ];
    expect(weekCounts(activity, "2026-10-19")).toEqual([2, 0, 5, 0, 0, 0, 1]);
  });
  it("пустой ответ — семь нулей", () => {
    expect(weekCounts([], "2026-10-19")).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  it("даты вне недели игнорируются; неделя через границу месяца", () => {
    expect(weekCounts([{ date: "2026-10-18", count: 9 }, { date: "2026-11-01", count: 3 }], "2026-10-26")).toEqual([0, 0, 0, 0, 0, 0, 3]);
  });
});

describe("totalsOf", () => {
  it("серии, главы и фильмы раздельно", () => {
    const items = [
      title({ type: "series", ep: 12 }),
      title({ type: "anime", ep: 8 }),
      title({ type: "show", ep: 2 }),
      title({ type: "manga", ep: 40 }),
      title({ type: "book", ep: 3 }),
      title({ type: "audiobook", ep: 1 }),
      title({ type: "movie", st: "done", ep: 1 }),
      title({ type: "movie", st: "planned", ep: 0 }),
    ];
    expect(totalsOf(items)).toEqual({ episodes: 22, chapters: 44, movies: 1 });
  });
  it("пустая библиотека — нули", () => {
    expect(totalsOf([])).toEqual({ episodes: 0, chapters: 0, movies: 0 });
  });
  it("просмотренный фильм не прибавляет серию", () => {
    expect(totalsOf([title({ type: "movie", st: "done", ep: 1 })]).episodes).toBe(0);
  });
});

describe("watchHours", () => {
  it("серия ≈ 24 минуты", () => {
    expect(watchHours(0)).toBe(0);
    expect(watchHours(10)).toBe(4);
    expect(watchHours(100)).toBe(40);
  });
});

describe("yearBars", () => {
  it("складывает число тайтлов по периодам года выхода, прогресс не влияет", () => {
    const years = [
      { year: 2005, items: 1, progress: 3 },
      { year: 2009, items: 1, progress: 0 },
      { year: 2012, items: 4, progress: 7 },
      { year: 2021, items: 2, progress: 10 },
      { year: 2025, items: 1, progress: 1 },
    ];
    expect(yearBars(years)).toEqual([2, 4, 0, 2, 1]);
  });
  it("пустой список — пять нулей", () => {
    expect(yearBars([])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("isStatsEmpty", () => {
  it("пусто только без записей: тайтлы без прогресса диаграммы наполняют", () => {
    expect(isStatsEmpty(stats())).toBe(true);
    expect(isStatsEmpty(stats({ totalItems: 3, top: [] }))).toBe(false);
  });
});

describe("libraryBreakdown", () => {
  const lib = [
    title({ id: 1, type: "anime", g: ["Драма", "Комедия"], c: "Япония", y: 2008, ep: 12 }),
    title({ id: 2, type: "anime", g: ["Драма", "Без жанра"], c: "Япония", y: 2021, ep: 30, t: "Б" }),
    title({ id: 3, type: "movie", st: "done", g: ["Драма"], c: "—", y: 0, ep: 0 }),
    title({ id: 4, type: "book", g: ["Новый жанр"], c: "США", y: 2023, ep: 0 }),
  ];

  it("считает жанры, страны и годы по числу тайтлов, без заглушек", () => {
    const r = libraryBreakdown(lib, "all");
    expect(r.total).toBe(4);
    expect(r.genres).toEqual([["Драма", 3], ["Комедия", 1], ["Новый жанр", 1]]);
    expect(r.countries).toEqual([["Япония", 2], ["США", 1]]);
    expect(r.years).toEqual([1, 0, 0, 1, 1]);
  });

  it("фильтрует по типу", () => {
    const r = libraryBreakdown(lib, "anime");
    expect(r.total).toBe(2);
    expect(r.genres).toEqual([["Драма", 2], ["Комедия", 1]]);
    expect(libraryBreakdown(lib, "manga").genres).toEqual([]);
  });

  it("топ по прогрессу: просмотренный фильм = 1, нулевой прогресс не входит, лимит", () => {
    const r = libraryBreakdown(lib, "all", 2);
    expect(r.top.map((x) => [x.item.id, x.progress])).toEqual([[2, 30], [1, 12]]);
    expect(libraryBreakdown(lib, "movie").top.map((x) => x.progress)).toEqual([1]);
  });
});

describe("ratingBreakdown", () => {
  const lib = [
    title({ id: 1, type: "anime", rate: 8 }),
    title({ id: 2, type: "anime", rate: 8 }),
    title({ id: 3, type: "movie", rate: 5 }),
    title({ id: 4, type: "book", rate: 0 }),
    title({ id: 5, type: "book" }),
  ];
  it("считает оценки по значениям, среднюю и без оценки", () => {
    const r = ratingBreakdown(lib, "all");
    expect(r.counts).toEqual([0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(r).toMatchObject({ rated: 3, unrated: 2, avg: 7 });
  });
  it("фильтрует по типу; без оценок среднее 0", () => {
    expect(ratingBreakdown(lib, "anime")).toMatchObject({ rated: 2, unrated: 0, avg: 8 });
    expect(ratingBreakdown(lib, "book")).toMatchObject({ rated: 0, unrated: 2, avg: 0 });
  });
});
