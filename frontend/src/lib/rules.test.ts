import { describe, expect, it } from "vitest";
import { DEMO_ITEMS } from "./demo-data";
import { exportRows, findDuplicate, fixSt, hasSeasons, isReading, metaOf, parseBackup, pct, progressText, statusLabel, statusPatch, TYPES, TYPES_PLURAL, unitOf } from "./rules";

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
  it("смена статуса не трогает прогресс", () => {
    for (const st of ["done", "planned", "watching", "dropped"] as const) {
      expect(statusPatch(x, st)).toEqual({ ...x, st });
      expect(statusPatch({ ...x, ep: x.tot }, st).ep).toBe(x.tot);
    }
  });
  it("фильм: «просмотрен» ставит 1, остальные статусы 0", () => {
    const m = { ...x, type: "movie" as const, tot: 1, ep: 0 };
    expect(statusPatch(m, "done").ep).toBe(1);
    expect(statusPatch({ ...m, ep: 1 }, "planned").ep).toBe(0);
  });
});

describe("unitOf / metaOf", () => {
  it("книги и манга считаются в главах", () => expect(unitOf("manga", t).u).toBe("ch"));
  it("фильм — без счётчика серий", () => expect(unitOf("movie", t).u).toBe("film"));
  it("мета сериала содержит сезон и прогресс", () => expect(metaOf({ ...DEMO_ITEMS[0], se: 1 }, t)).toBe("С1 · 61 / 87 · 2013"));
  it("общее число неизвестно (tot = 0): прогресс без знаменателя", () => {
    expect(metaOf({ ...DEMO_ITEMS[0], se: 1, ep: 5, tot: 0 }, t)).toBe("С1 · 5 · 2013");
    expect(metaOf({ ...DEMO_ITEMS[0], type: "manga", vol: undefined, ep: 40, tot: 0 }, t)).toBe("40 гл. · 2013");
  });
});

describe("progressText / pct", () => {
  it("«ep / tot» или просто «ep» при неизвестном общем числе", () => {
    expect(progressText(5, 12)).toBe("5 / 12");
    expect(progressText(5, 0)).toBe("5");
  });
  it("pct: проценты, а при tot = 0 шкала пустая", () => {
    expect(pct(3, 12)).toBe(25);
    expect(pct(5, 0)).toBe(0);
  });
  it("экспорт: прогресс без знаменателя при tot = 0", () => {
    const { head, body } = exportRows([{ ...DEMO_ITEMS[0], ep: 5, tot: 0 }], t);
    expect(body[0][head.indexOf("Прогресс")]).toBe("5");
  });
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

describe("findDuplicate", () => {
  const a = { ...DEMO_ITEMS[0], id: 1, type: "anime" as const, t: "Ходячий замок", en: "Howl's Moving Castle" };
  const lib = [a, { ...a, id: 2, type: "movie" as const, t: "Другое", en: "Other" }];
  it("находит по названию без учёта регистра и пробелов", () => {
    expect(findDuplicate(lib, { type: "anime", t: "  ходячий   ЗАМОК " })?.id).toBe(1);
  });
  it("находит по оригинальному названию", () => {
    expect(findDuplicate(lib, { type: "anime", t: "Новое", en: "howl's moving castle" })?.id).toBe(1);
  });
  it("другой тип — не дубликат", () => expect(findDuplicate(lib, { type: "manga", t: "Ходячий замок" })).toBeUndefined());
  it("саму редактируемую запись не считает", () => expect(findDuplicate(lib, { id: 1, type: "anime", t: "Ходячий замок" })).toBeUndefined());
  it("пустое название не совпадает ни с чем", () => expect(findDuplicate(lib, { type: "anime", t: " ", en: "" })).toBeUndefined());
});
