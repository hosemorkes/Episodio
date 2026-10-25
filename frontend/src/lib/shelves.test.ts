import { describe, expect, it } from "vitest";
import { buildShelves, filterLive, interleave, recommendLive, sortLive, topGenres, YEAR_OK } from "./shelves";
import type { CatalogResult, Title, TitleType } from "./types";

const t = (s: string) => s;

const res = (n: number, over: Partial<CatalogResult> = {}): CatalogResult => ({
  key: `tmdb:${n}:tv_series`,
  source: "tmdb",
  extId: String(n),
  type: "series",
  t: `Тайтл ${n}`,
  y: 2020,
  g: [],
  c: "—",
  ...over,
});

const mine = (over: Partial<Title> = {}): Title => ({
  id: 1,
  type: "series",
  st: "watching",
  t: "Моё",
  y: 2015,
  c: "США",
  g: ["Драма"],
  ep: 3,
  tot: 10,
  h: [0, 0],
  ...over,
});

describe("YEAR_OK", () => {
  it("границы периодов", () => {
    expect(YEAR_OK["2020"](2020)).toBe(true);
    expect(YEAR_OK["2010"](2019)).toBe(true);
    expect(YEAR_OK["2010"](2020)).toBe(false);
    expect(YEAR_OK["2000"](2000)).toBe(true);
    expect(YEAR_OK.old(1999)).toBe(true);
  });
});

describe("filterLive", () => {
  const list = [res(1, { g: ["Драма", "Комедия"], y: 2021 }), res(2, { g: ["Драма"], y: 2012 }), res(3, { g: ["Комедия"], y: 0 })];
  it("без фильтров возвращает всё", () => expect(filterLive(list, [], "all")).toHaveLength(3));
  it("жанры применяются все сразу", () => {
    expect(filterLive(list, ["Драма"], "all").map((r) => r.extId)).toEqual(["1", "2"]);
    expect(filterLive(list, ["Драма", "Комедия"], "all").map((r) => r.extId)).toEqual(["1"]);
  });
  it("год: записи без года под фильтр не попадают", () => {
    expect(filterLive(list, [], "2020").map((r) => r.extId)).toEqual(["1"]);
    expect(filterLive(list, [], "old")).toEqual([]);
    expect(filterLive(list, [], "2010").map((r) => r.extId)).toEqual(["2"]);
  });
  it("жанр и год вместе", () => expect(filterLive(list, ["Комедия"], "2020").map((r) => r.extId)).toEqual(["1"]));
});

describe("sortLive", () => {
  const list = [res(1, { rating: 7, y: 2010 }), res(2, { y: 2024 }), res(3, { rating: 9, y: 2018 })];
  it("по популярности сохраняет порядок сервера", () => expect(sortLive(list, "pop").map((r) => r.extId)).toEqual(["1", "2", "3"]));
  it("по рейтингу: без оценки в конце", () => expect(sortLive(list, "rating").map((r) => r.extId)).toEqual(["3", "1", "2"]));
  it("новинки по году", () => expect(sortLive(list, "new").map((r) => r.extId)).toEqual(["2", "3", "1"]));
  it("исходный массив не меняется", () => {
    sortLive(list, "rating");
    expect(list.map((r) => r.extId)).toEqual(["1", "2", "3"]);
  });
});

describe("interleave", () => {
  const typed = (n: number, type: TitleType) => res(n, { type, key: `${type}:${n}` });
  it("чередует категории, сохраняя порядок внутри каждой", () => {
    const out = interleave([typed(1, "anime"), typed(2, "anime"), typed(3, "anime"), typed(4, "movie"), typed(5, "movie"), typed(6, "book")]);
    expect(out.map((r) => r.extId)).toEqual(["1", "4", "6", "2", "5", "3"]);
  });
  it("одна категория и пустой список", () => {
    expect(interleave([typed(1, "anime"), typed(2, "anime")]).map((r) => r.extId)).toEqual(["1", "2"]);
    expect(interleave([])).toEqual([]);
  });
});

describe("topGenres", () => {
  it("по частоте, при равенстве по алфавиту, не больше limit", () => {
    const list = [res(1, { g: ["Б", "А"] }), res(2, { g: ["Б"] }), res(3, { g: ["В"] })];
    expect(topGenres(list)).toEqual(["Б", "А", "В"]);
    expect(topGenres(list, 2)).toEqual(["Б", "А"]);
  });
  it("без жанров пусто", () => expect(topGenres([res(1)])).toEqual([]));
});

describe("recommendLive", () => {
  it("не рекомендует то, что уже в библиотеке, и ставит совпадение жанров выше", () => {
    const items = [mine({ g: ["Драма"] }), mine({ id: 2, t: "Второе", g: ["Драма"] })];
    const list = [
      res(1, { t: "Моё", g: ["Драма"] }), // уже есть
      res(2, { g: ["Комедия"], rating: 9.5 }),
      res(3, { g: ["Драма"], rating: 6 }),
    ];
    expect(recommendLive(items, list, 5).map((r) => r.extId)).toEqual(["3"]);
  });
  it("пустая библиотека — рекомендаций нет", () => expect(recommendLive([], [res(1, { g: ["Драма"] })], 5)).toEqual([]));
  it("limit", () => {
    const items = [mine()];
    const list = [res(1, { g: ["Драма"] }), res(2, { g: ["Драма"] }), res(3, { g: ["Драма"] })].map((r, i) => ({ ...r, t: `Новое ${i}` }));
    expect(recommendLive(items, list, 2)).toHaveLength(2);
  });
});

describe("buildShelves", () => {
  const list = [
    res(1, { g: ["Драма"], rating: 8.1 }),
    res(2, { g: ["Драма"], rating: 9.0 }),
    res(3, { g: ["Драма", "Комедия"], rating: 7.2 }),
    res(4, { g: ["Комедия"], rating: 8.8 }),
    res(5, { g: ["Фантастика"] }),
  ];

  it("популярное всегда первое и содержит результаты в порядке сервера", () => {
    const shelves = buildShelves(list, [], t);
    expect(shelves[0].key).toBe("pop");
    expect(shelves[0].cards.map((r) => r.extId)).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("полка жанра: не меньше трёх оценённых, лучшие по оценке первыми", () => {
    const shelves = buildShelves(list, [], t);
    const drama = shelves.find((s) => s.key === "g-Драма");
    expect(drama?.cards.map((r) => r.extId)).toEqual(["2", "1", "3"]);
    expect(shelves.find((s) => s.key === "g-Комедия")).toBeUndefined(); // только два оценённых
    expect(drama?.title).toBe("Топ в жанре Драма");
  });
  it("не больше двух полок жанров", () => {
    const many = ["А", "Б", "В"].flatMap((g, gi) => [1, 2, 3].map((n) => res(gi * 10 + n, { g: [g], rating: 5 + n })));
    expect(buildShelves(many, [], t).filter((s) => s.key.startsWith("g-"))).toHaveLength(2);
  });
  it("рекомендации по библиотеке появляются, когда есть что порекомендовать", () => {
    const shelves = buildShelves(list, [mine({ g: ["Драма"] })], t);
    const ai = shelves.find((s) => s.key === "ai");
    expect(ai).toBeDefined();
    expect(ai?.sub).toBe("На основе ваших тайтлов: Драма");
    expect(buildShelves(list, [], t).find((s) => s.key === "ai")).toBeUndefined();
  });
  it("пустая подборка — нет полок", () => expect(buildShelves([], [], t)).toEqual([]));
});
