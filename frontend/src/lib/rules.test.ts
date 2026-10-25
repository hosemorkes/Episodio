import { describe, expect, it } from "vitest";
import { DEMO_ITEMS } from "./demo-data";
import { exportRows, fixSt, hasSeasons, isReading, metaOf, parseBackup, statusLabel, statusPatch, TYPES, TYPES_PLURAL, unitOf } from "./rules";

const t = (s: string) => s;

describe("fixSt", () => {
  it("последняя серия переводит в «просмотрено»", () => expect(fixSt("watching", 5, 5)).toBe("done"));
  it("начатое из «в планах» становится «смотрю»", () => expect(fixSt("planned", 1, 5)).toBe("watching"));
  it("«просмотрено» при откате становится «смотрю»", () => expect(fixSt("done", 3, 5)).toBe("watching"));
  it("брошенное не меняется, пока не досмотрено", () => expect(fixSt("dropped", 2, 5)).toBe("dropped"));
  it("неизвестное «всего» (0) не делает тайтл просмотренным", () => {
    expect(fixSt("watching", 3, 0)).toBe("watching");
    expect(fixSt("planned", 1, 0)).toBe("watching");
  });
});

describe("категории", () => {
  it("в интерфейсе все 8 категорий, у каждой есть название во множественном числе", () => {
    expect(TYPES.map(([k]) => k).sort()).toEqual(["anime", "audiobook", "book", "cartoon", "manga", "movie", "series", "show"]);
    for (const [k] of TYPES) expect(TYPES_PLURAL[k]).toBeTruthy();
  });
  it("сезоны: аниме, мультсериалы, сериалы, ТВ-шоу", () => {
    expect(TYPES.filter(([k]) => hasSeasons(k)).map(([k]) => k).sort()).toEqual(["anime", "cartoon", "series", "show"]);
  });
  it("главы: манга, книги, аудиокниги", () => {
    expect(TYPES.filter(([k]) => isReading(k)).map(([k]) => k).sort()).toEqual(["audiobook", "book", "manga"]);
  });
  it("аудиокнига: слушаю, прослушано, главы", () => {
    expect(unitOf("audiobook", t)).toMatchObject({ u: "ch", done: "Все главы прослушаны" });
    expect(statusLabel("watching", "audiobook", t, "")).toBe("Слушаю");
    expect(statusLabel("done", "audiobook", t, "")).toBe("Прослушано");
    expect(statusLabel("done", "book", t, "")).toBe("Прочитано");
  });
  it("мета книги: том, главы, год", () => {
    const base = { ...DEMO_ITEMS[0], type: "book" as const, ep: 3, tot: 10, y: 1965 };
    expect(metaOf(base, t)).toBe("3 / 10 гл. · 1965");
    expect(metaOf({ ...base, vol: 2 }, t)).toBe("Т2 · 3 / 10 гл. · 1965");
  });
});

describe("statusPatch", () => {
  const x = DEMO_ITEMS[0];
  it("«просмотрено» ставит ep=tot", () => expect(statusPatch(x, "done").ep).toBe(x.tot));
  it("«в планах» обнуляет прогресс", () => expect(statusPatch(x, "planned").ep).toBe(0));
  it("«смотрю» у законченного откатывает на серию назад", () => {
    expect(statusPatch({ ...x, ep: x.tot }, "watching").ep).toBe(x.tot - 1);
  });
  it("неизвестное «всего»: «просмотрено» не трогает прогресс", () => {
    expect(statusPatch({ ...x, ep: 7, tot: 0 }, "done").ep).toBe(7);
  });
});

describe("unitOf / metaOf", () => {
  it("книги и манга считаются в главах", () => expect(unitOf("manga", t).u).toBe("ch"));
  it("фильм — без счётчика серий", () => expect(unitOf("movie", t).u).toBe("film"));
  it("мета сериала содержит сезон и прогресс", () => expect(metaOf({ ...DEMO_ITEMS[0], se: 1 }, t)).toBe("С1 · 61 / 87 · 2013"));
});

describe("parseBackup", () => {
  it("принимает объект с items", () => expect(parseBackup({ items: DEMO_ITEMS })?.items).toHaveLength(DEMO_ITEMS.length));
  it("отклоняет мусор", () => {
    expect(parseBackup({ items: [{ x: 1 }] })).toBeNull();
    expect(parseBackup("text")).toBeNull();
  });
});

describe("exportRows", () => {
  it("строк столько же, сколько тайтлов, колонок 16", () => {
    const { head, body } = exportRows(DEMO_ITEMS, t);
    expect(head).toHaveLength(16);
    expect(body).toHaveLength(DEMO_ITEMS.length);
    for (const row of body) expect(row).toHaveLength(head.length);
  });
  it("автор, том и заметка попадают в экспорт", () => {
    const { head, body } = exportRows([{ ...DEMO_ITEMS[0], type: "book", vol: 2, author: "Герберт", tr: "LostFilm", link: "https://x.test", note: "Топ" }], t);
    const row = Object.fromEntries(head.map((h, i) => [h, body[0][i]]));
    expect(row).toMatchObject({ Том: 2, Автор: "Герберт", Озвучка: "LostFilm", Ссылка: "https://x.test", Заметка: "Топ" });
  });
});
