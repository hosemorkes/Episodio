import { describe, expect, it } from "vitest";
import { defaultTitle, describeView, draftOf, GENITIVE, periodLabel, sameDraft, SHOWCASE_SIZES, sharePath, showcaseYears } from "./showcases";
import type { Showcase, ShowcaseDraft, ShowcaseView } from "./types";

const t = (s: string) => s;
const draft = (over: Partial<ShowcaseDraft> = {}): ShowcaseDraft => ({ title: "Топ", type: "all", year: 2026, month: null, max: 8, ...over });
const showcase = (over: Partial<Showcase> = {}): Showcase => ({ id: 1, slug: "top-all-2026", title: "Топ", type: "all", year: 2026, month: null, max: 8, isPublic: false, ...over });

describe("showcaseYears", () => {
  it("текущий год и шесть предыдущих", () => {
    expect(showcaseYears(new Date(2026, 5, 1))).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  });
});

describe("periodLabel / defaultTitle", () => {
  it("период: всё время, год, год и месяц", () => {
    expect(periodLabel(null, null, t)).toBe("за всё время");
    expect(periodLabel(2026, null, t)).toBe("2026");
    expect(periodLabel(2026, 3, t)).toBe("2026, март");
    expect(periodLabel(2026, 12, t)).toBe("2026, декабрь");
  });
  it("название по умолчанию для каждого сочетания", () => {
    expect(defaultTitle({ type: "anime", year: 2026, month: 3 }, t)).toBe("Мой топ аниме 2026, март");
    expect(defaultTitle({ type: "series", year: 2025, month: null }, t)).toBe("Мой топ сериалов 2025");
    expect(defaultTitle({ type: "all", year: 2026, month: null }, t)).toBe("Мой топ 2026");
    expect(defaultTitle({ type: "book", year: null, month: null }, t)).toBe("Мой топ книг за всё время");
    expect(defaultTitle({ type: "all", year: null, month: null }, t)).toBe("Мой топ за всё время");
  });
  it("у каждой категории есть родительный падеж", () => {
    for (const k of ["anime", "cartoon", "series", "movie", "show", "manga", "book", "audiobook"] as const) expect(GENITIVE[k]).not.toBe("");
  });
});

describe("draftOf / sameDraft", () => {
  it("черновик из сохранённой витрины совпадает с ней", () => {
    expect(sameDraft(draft(), draftOf(showcase()))).toBe(true);
  });
  it("любое изменение параметров делает черновик другим", () => {
    const base = draftOf(showcase());
    expect(sameDraft(draft({ title: "Другое" }), base)).toBe(false);
    expect(sameDraft(draft({ type: "anime" }), base)).toBe(false);
    expect(sameDraft(draft({ year: 2025 }), base)).toBe(false);
    expect(sameDraft(draft({ month: 3 }), base)).toBe(false);
    expect(sameDraft(draft({ max: 12 }), base)).toBe(false);
  });
  it("лишние пробелы в названии не считаются изменением", () => {
    expect(sameDraft(draft({ title: "  Топ " }), draftOf(showcase()))).toBe(true);
  });
  it("месяц без года не учитывается", () => {
    expect(sameDraft(draft({ year: null, month: 5 }), draft({ year: null, month: null }))).toBe(true);
  });
});

describe("sharePath / SHOWCASE_SIZES", () => {
  it("путь публичной страницы", () => expect(sharePath("me", "top-anime-2026-03")).toBe("/u/me/top-anime-2026-03"));
  it("варианты числа мест в пределах 1–50 бэкенда", () => {
    expect(SHOWCASE_SIZES.every((n) => n >= 1 && n <= 50)).toBe(true);
  });
});

describe("describeView", () => {
  const view = (cards: ShowcaseView["cards"]): ShowcaseView => ({ title: "Т", type: "all", year: 2026, month: null, cards });
  const card = (t_: string, rate: number, en?: string) => ({ t: t_, en, type: "series" as const, y: 2020, g: [], c: "—", rate });
  it("пустая витрина", () => expect(describeView(view([]), t)).toBe("Пока здесь пусто"));
  it("первые пять мест с оценками", () => {
    const cards = Array.from({ length: 7 }, (_, i) => card(`Т${i + 1}`, 10 - i));
    expect(describeView(view(cards), t)).toBe("Топ из 7: 1. Т1 (10), 2. Т2 (9), 3. Т3 (8), 4. Т4 (7), 5. Т5 (6)");
  });
  it("английские названия для lang=en, если есть", () => {
    expect(describeView(view([card("Фрирен", 10, "Frieren"), card("Без", 9)]), t, "en")).toBe("Топ из 2: 1. Frieren (10), 2. Без (9)");
  });
});
