import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// В node-окружении нет localStorage: подставляем простую заглушку до создания хранилища
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
});

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const names = ["listItems", "getItem", "createItem", "updateItem", "patchItem", "deleteItem", "progress", "listLog", "listGenres", "searchCatalog", "addFromCatalog", "uploadPoster", "deletePoster", "listCandidates", "applyCandidate", "getStats"];
  return { ...actual, api: Object.fromEntries(names.map((n) => [n, vi.fn()])) };
});

import { api, ApiError } from "./api";
import { draftOf, emptyDraft, useStore } from "./store";
import type { LogEntry, Stats, Title } from "./types";

const m = vi.mocked(api);

const title = (over: Partial<Title> = {}): Title => ({
  id: 1,
  type: "series",
  st: "watching",
  t: "Медведь",
  y: 2022,
  c: "США",
  g: ["Драма"],
  se: 1,
  ep: 2,
  tot: 8,
  h: [10, 50],
  ...over,
});

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({ id: 1, day: "СЕГОДНЯ", title: "Медведь", ep: 2, time: "10:00", u: "ep", ...over });

/** Даёт отработать всем отложенным промисам хранилища */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const state = () => useStore.getState();
const item = (id = 1) => state().items.find((x) => x.id === id)!;

function reset(items: Title[], log: LogEntry[] = []) {
  useStore.setState({ items, log, logEnd: false, lastId: null, lang: "ru", toast: "", loaded: true, loadError: null, hydrated: true, pulse: null });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.listLog.mockResolvedValue([]);
});

afterEach(async () => {
  await settle();
});

describe("mark (+1)", () => {
  it("сразу двигает счётчик, пишет временную запись и отправляет на сервер", async () => {
    reset([title({ st: "planned", ep: 0 })]);
    const saved = title({ ep: 1, st: "watching" });
    const real = entry({ id: 9, ep: 1 });
    m.progress.mockResolvedValue({ item: saved, entry: real });

    state().mark(1);
    expect(item()).toMatchObject({ ep: 1, st: "watching" });
    expect(state().log[0]).toMatchObject({ title: "Медведь", ep: 1, day: "СЕГОДНЯ" });
    expect(state().log[0].id).toBeUndefined();
    expect(state().lastId).toBe(1);

    await settle();
    expect(m.progress).toHaveBeenCalledWith(1, 1);
    expect(state().log[0]).toBe(real);
  });

  it("последняя серия — тайтл просмотрен", async () => {
    reset([title({ ep: 7, tot: 8 })]);
    m.progress.mockResolvedValue({ item: title({ ep: 8, st: "done" }), entry: entry() });
    state().mark(1);
    expect(item()).toMatchObject({ ep: 8, st: "done" });
  });

  it("всё уже отмечено: запроса нет, показывается сообщение", async () => {
    reset([title({ ep: 8, tot: 8, st: "done" })]);
    state().mark(1);
    await settle();
    expect(m.progress).not.toHaveBeenCalled();
    expect(state().toast).toContain("Медведь");
  });

  it("неизвестное «всего» не блокирует отметку", async () => {
    reset([title({ ep: 3, tot: 0 })]);
    m.progress.mockResolvedValue({ item: title({ ep: 4, tot: 0 }), entry: entry({ ep: 4 }) });
    state().mark(1);
    await settle();
    expect(m.progress).toHaveBeenCalledWith(1, 1);
    expect(item().ep).toBe(4);
  });

  it("брошенный тайтл остаётся брошенным, как на сервере", async () => {
    reset([title({ st: "dropped" })]);
    m.progress.mockResolvedValue({ item: title({ st: "dropped", ep: 3 }), entry: entry() });
    state().mark(1);
    expect(item().st).toBe("dropped");
  });

  it("ошибка сервера: тост и сверка с сервером вместо локальной правды", async () => {
    reset([title({ ep: 2 })], [entry()]);
    m.progress.mockRejectedValue(new ApiError(500, "Сервер упал"));
    m.getItem.mockResolvedValue(title({ ep: 2 }));
    m.listLog.mockResolvedValue([entry({ id: 5 })]);

    state().mark(1);
    expect(item().ep).toBe(3);
    await settle();

    expect(state().toast).toBe("Сервер упал");
    expect(item().ep).toBe(2);
    expect(m.getItem).toHaveBeenCalledWith(1);
    expect(state().log).toEqual([entry({ id: 5 })]);
  });

  it("быстрые нажатия идут на сервер по очереди, ответ первого не откатывает счётчик", async () => {
    reset([title({ ep: 0 })]);
    let first!: (v: { item: Title; entry: LogEntry }) => void;
    m.progress.mockImplementationOnce(() => new Promise((r) => (first = r)));
    m.progress.mockResolvedValueOnce({ item: title({ ep: 2 }), entry: entry({ id: 2, ep: 2 }) });

    state().mark(1);
    state().mark(1);
    await settle();
    expect(m.progress).toHaveBeenCalledTimes(1);
    expect(item().ep).toBe(2);

    first({ item: title({ ep: 1 }), entry: entry({ id: 1, ep: 1 }) });
    await settle();
    expect(m.progress).toHaveBeenCalledTimes(2);
    expect(item().ep).toBe(2);
  });

  it("фильм: статус completed через PATCH, журнал читается заново", async () => {
    reset([title({ type: "movie", st: "planned", ep: 0, tot: 1 })]);
    m.patchItem.mockResolvedValue(title({ type: "movie", st: "done", ep: 1, tot: 1 }));
    m.listLog.mockResolvedValue([entry({ id: 7, ep: 1, u: "film" })]);

    state().mark(1);
    expect(item()).toMatchObject({ ep: 1, st: "done" });
    await settle();
    expect(m.progress).not.toHaveBeenCalled();
    expect(m.patchItem).toHaveBeenCalledWith(1, { status: "completed" });
    expect(state().log).toEqual([entry({ id: 7, ep: 1, u: "film" })]);
  });
});

describe("minus (−1)", () => {
  it("уменьшает счётчик и убирает последнюю запись этого тайтла", async () => {
    reset([title({ ep: 3 }), title({ id: 2, t: "Шерлок", ep: 1 })], [entry({ id: 3, title: "Шерлок" }), entry({ id: 2, ep: 3 }), entry({ id: 1, ep: 2 })]);
    m.progress.mockResolvedValue({ item: title({ ep: 2 }), entry: entry({ id: 2 }) });

    state().minus(1);
    expect(item()).toMatchObject({ ep: 2 });
    expect(state().log.map((e) => e.id)).toEqual([3, 1]);
    await settle();
    expect(m.progress).toHaveBeenCalledWith(1, -1);
  });

  it("не опускается ниже нуля и при пустом журнале не падает", async () => {
    reset([title({ ep: 0, st: "planned" })]);
    m.progress.mockResolvedValue({ item: title({ ep: 0, st: "planned" }), entry: null });
    state().minus(1);
    await settle();
    expect(item().ep).toBe(0);
  });

  it("из «просмотрено» возвращает в «смотрю»", async () => {
    reset([title({ ep: 8, st: "done" })]);
    m.progress.mockResolvedValue({ item: title({ ep: 7 }), entry: null });
    state().minus(1);
    expect(item()).toMatchObject({ ep: 7, st: "watching" });
  });

  it("фильм: «просмотрен» → «в планах» через сохранение", async () => {
    reset([title({ type: "movie", st: "done", ep: 1, tot: 1 })]);
    m.updateItem.mockResolvedValue(title({ type: "movie", st: "planned", ep: 0, tot: 1 }));
    state().minus(1);
    expect(item()).toMatchObject({ st: "planned", ep: 0 });
    await settle();
    expect(m.progress).not.toHaveBeenCalled();
    expect(m.updateItem).toHaveBeenCalledTimes(1);
    expect(m.updateItem.mock.calls[0][1]).toMatchObject({ st: "planned" });
  });
});

describe("статус, оценка, заметка", () => {
  it("setStatus: «просмотрено» ставит ep=tot и отправляет карточку", async () => {
    reset([title({ ep: 2, tot: 8 })]);
    m.updateItem.mockResolvedValue(title({ ep: 8, st: "done" }));
    state().setStatus(1, "done");
    expect(item()).toMatchObject({ st: "done", ep: 8 });
    await settle();
    expect(m.updateItem.mock.calls[0][0]).toBe(1);
    expect(m.updateItem.mock.calls[0][1]).toMatchObject({ st: "done", ep: 8 });
  });

  it("setStatus у фильма перечитывает журнал", async () => {
    reset([title({ type: "movie", st: "planned", ep: 0, tot: 1 })]);
    m.updateItem.mockResolvedValue(title({ type: "movie", st: "done", ep: 1, tot: 1 }));
    state().setStatus(1, "done");
    await settle();
    expect(m.listLog).toHaveBeenCalled();
  });

  it("setRate: ставит и снимает оценку (null в БД)", async () => {
    reset([title({ rate: 0 })]);
    m.patchItem.mockImplementation(async () => title());
    state().setRate(1, 9);
    expect(item().rate).toBe(9);
    state().setRate(1, 9);
    expect(item().rate).toBe(0);
    await settle();
    expect(m.patchItem.mock.calls.map((c) => c[1])).toEqual([{ rating: 9 }, { rating: null }]);
  });

  it("setNote: сохраняет, пустой текст удаляет", async () => {
    reset([title()]);
    m.patchItem.mockImplementation(async () => title());
    state().setNote(1, "  Топ  ");
    expect(item().note).toBe("Топ");
    state().setNote(1, "   ");
    expect(item().note).toBeUndefined();
    await settle();
    expect(m.patchItem.mock.calls.map((c) => c[1])).toEqual([{ comment: "Топ" }, { comment: null }]);
  });

  it("ошибка сохранения заметки: возвращается серверное значение", async () => {
    reset([title({ note: "старая" })]);
    m.patchItem.mockRejectedValue(new ApiError(0, "Нет связи с сервером"));
    m.getItem.mockResolvedValue(title({ note: "старая" }));
    state().setNote(1, "новая");
    await settle();
    expect(item().note).toBe("старая");
    expect(state().toast).toBe("Нет связи с сервером");
  });
});

describe("deleteTitle", () => {
  it("убирает сразу и удаляет на сервере", async () => {
    reset([title(), title({ id: 2 })]);
    state().lastId = 1;
    m.deleteItem.mockResolvedValue(undefined);
    state().deleteTitle(1);
    expect(state().items.map((x) => x.id)).toEqual([2]);
    expect(state().lastId).toBeNull();
    await settle();
    expect(m.deleteItem).toHaveBeenCalledWith(1);
  });

  it("при ошибке тайтл возвращается", async () => {
    reset([title()]);
    m.deleteItem.mockRejectedValue(new ApiError(500, "Не вышло"));
    m.getItem.mockResolvedValue(title());
    state().deleteTitle(1);
    expect(state().items).toHaveLength(0);
    await settle();
    expect(state().items.map((x) => x.id)).toEqual([1]);
    expect(state().toast).toBe("Не вышло");
  });

  it("404 при удалении — не ошибка", async () => {
    reset([title()]);
    m.deleteItem.mockRejectedValue(new ApiError(404, "Элемент не найден"));
    state().deleteTitle(1);
    await settle();
    expect(state().items).toHaveLength(0);
    expect(state().toast).toBe("Тайтл удалён");
  });
});

describe("saveTitle", () => {
  const draft = (over = {}) => ({ ...emptyDraft(), t: "Фрирен", en: "Frieren", g: ["Фэнтези"], ep: "0", tot: "28", ...over });

  it("пустое название: запроса нет", async () => {
    reset([]);
    expect(await state().saveTitle(draft({ t: "  " }))).toBeNull();
    expect(m.createItem).not.toHaveBeenCalled();
  });

  it("новый тайтл создаётся на сервере и получает id оттуда", async () => {
    reset([title()]);
    m.createItem.mockResolvedValue(title({ id: 42, t: "Фрирен", type: "anime", st: "planned", ep: 0, tot: 28 }));
    const id = await state().saveTitle(draft());
    expect(id).toBe(42);
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ t: "Фрирен", en: "Frieren", type: "anime", st: "planned", tot: 28 });
    expect(state().items[0].id).toBe(42);
    expect(state().lastId).toBe(42);
    expect(state().toast).toBe("Тайтл добавлен");
  });

  it("начатый тайтл создаётся со статусом «смотрю»", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5 }));
    await state().saveTitle(draft({ ep: "3" }));
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ st: "watching", ep: 3 });
  });

  it("пустое «Всего»: идущий сериал сохраняется с tot = 0, прогресс не обрезается", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5, tot: 0 }));
    await state().saveTitle(draft({ ep: "15", tot: "" }));
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ st: "watching", ep: 15, tot: 0 });
  });

  it("форма редактирования: неизвестное «Всего» показывается пустым, а не «0»", () => {
    expect(draftOf(title({ tot: 0 })).tot).toBe("");
    expect(draftOf(title({ tot: 8 })).tot).toBe("8");
  });

  it("фильм: всего 1", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5, type: "movie" }));
    await state().saveTitle(draft({ type: "movie", tot: "99", ep: "5" }));
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ tot: 1, ep: 1 });
  });

  it("том, автор, озвучка, ссылка доходят до сервера; у сериала том отбрасывается", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5 }));
    await state().saveTitle(draft({ type: "book", vol: "2", author: " Герберт ", tr: "", link: "https://x.test" }));
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ vol: 2, author: "Герберт", tr: undefined, link: "https://x.test" });
    await state().saveTitle(draft({ type: "series", vol: "2" }));
    expect(m.createItem.mock.calls[1][0].vol).toBeUndefined();
  });

  it("правка: PATCH с изменениями и пересчётом статуса", async () => {
    reset([title({ ep: 2, tot: 8, st: "watching", note: "заметка" })]);
    m.updateItem.mockImplementation(async (_id, it) => ({ ...(it as Title), id: 1, h: [1, 2] }));
    const id = await state().saveTitle({ ...draft({ type: "series", t: "Медведь", ep: "8", tot: "8" }), id: 1 });
    expect(id).toBe(1);
    expect(m.createItem).not.toHaveBeenCalled();
    expect(m.updateItem.mock.calls[0][1]).toMatchObject({ t: "Медведь", st: "done", note: "заметка" });
    expect(item()).toMatchObject({ st: "done", ep: 8 });
    expect(state().items).toHaveLength(1);
    expect(state().toast).toBe("Сохранено");
  });

  it("новый постер (dataURL) загружается файлом", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5 }));
    m.uploadPoster.mockResolvedValue(title({ id: 5, img: "/api/backend/posters/5.jpg" }));
    await state().saveTitle(draft({ img: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }));
    expect(m.uploadPoster).toHaveBeenCalledTimes(1);
    expect(m.uploadPoster.mock.calls[0][0]).toBe(5);
    expect(m.uploadPoster.mock.calls[0][1]).toBeInstanceOf(File);
    expect(item(5).img).toBe("/api/backend/posters/5.jpg");
  });

  it("убранный постер удаляется, нетронутый — нет", async () => {
    reset([title({ img: "/api/backend/posters/1.jpg" })]);
    m.updateItem.mockImplementation(async (_id, it) => ({ ...(it as Title), id: 1, h: [1, 2] }));
    m.deletePoster.mockResolvedValue(title({ img: undefined }));
    await state().saveTitle({ ...draft(), id: 1, img: "/api/backend/posters/1.jpg" });
    expect(m.deletePoster).not.toHaveBeenCalled();
    await state().saveTitle({ ...draft(), id: 1, img: "" });
    expect(m.deletePoster).toHaveBeenCalledWith(1);
    expect(m.uploadPoster).not.toHaveBeenCalled();
  });

  it("постер не загрузился: тайтл всё равно сохранён", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5 }));
    m.uploadPoster.mockRejectedValue(new ApiError(400, "Файл слишком большой"));
    const id = await state().saveTitle(draft({ img: "data:image/jpeg;base64,/9j/4AAQ" }));
    expect(id).toBe(5);
    expect(item(5)).toBeTruthy();
  });

  it("ошибка сервера: null и тост, список не меняется", async () => {
    reset([title()]);
    m.createItem.mockRejectedValue(new ApiError(422, "Поле title_ru обязательно"));
    expect(await state().saveTitle(draft())).toBeNull();
    expect(state().items).toHaveLength(1);
    expect(state().toast).toBe("Поле title_ru обязательно");
  });
});

describe("addFromCatalog", () => {
  const cat = { id: 3, type: "anime" as const, t: "Фрирен", en: "Frieren", y: 2023, g: ["Фэнтези"], c: "Япония", r: 9, p: 5, s: "d" as const, tot: 28, h: 100 };

  it("создаёт запись на сервере с нужным статусом", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 11, t: "Фрирен" }));
    await state().addFromCatalog(cat, "planned");
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ t: "Фрирен", st: "planned", tot: 28, ep: 0 });
    expect(state().items[0].id).toBe(11);
    expect(state().toast).toBe("Добавлено: Фрирен");
  });

  it("ошибка: запись не добавляется", async () => {
    reset([]);
    m.createItem.mockRejectedValue(new ApiError(0, "Нет связи с сервером"));
    await state().addFromCatalog(cat, "planned");
    expect(state().items).toHaveLength(0);
    expect(state().toast).toBe("Нет связи с сервером");
  });
});

describe("addFromSearch", () => {
  const found = {
    key: "tmdb:603:movie", source: "tmdb", extId: "603", type: "movie" as const, t: "Матрица", en: "The Matrix", y: 1999, g: ["Фантастика"], c: "США", img: "https://image.tmdb.org/x.jpg",
  };

  it("добавляет в начало библиотеки то, что вернул сервер, и сообщает", async () => {
    reset([title()]);
    m.addFromCatalog.mockResolvedValue(title({ id: 77, t: "Матрица", type: "movie", st: "planned", img: "/api/backend/posters/77.jpg" }));
    expect(await state().addFromSearch(found, "planned")).toBe(true);
    expect(m.addFromCatalog).toHaveBeenCalledWith(found, "planned");
    expect(state().items.map((x) => x.id)).toEqual([77, 1]);
    expect(state().lastId).toBe(77);
    expect(state().toast).toBe("Добавлено: Матрица");
  });

  it("английский язык: название из оригинала", async () => {
    reset([]);
    useStore.setState({ lang: "en" });
    m.addFromCatalog.mockResolvedValue(title({ id: 78 }));
    await state().addFromSearch(found, "planned");
    expect(state().toast).toBe("Added: The Matrix");
  });

  it("дубликат (409): список не меняется, показывается ответ сервера", async () => {
    reset([title()]);
    m.addFromCatalog.mockRejectedValue(new ApiError(409, "Уже в библиотеке: Матрица"));
    expect(await state().addFromSearch(found, "planned")).toBe(false);
    expect(state().items).toHaveLength(1);
    expect(state().toast).toBe("Уже в библиотеке: Матрица");
  });

  it("повторный ответ с тем же id не создаёт копию", async () => {
    reset([title({ id: 77 })]);
    m.addFromCatalog.mockResolvedValue(title({ id: 77 }));
    await state().addFromSearch(found, "planned");
    expect(state().items.filter((x) => x.id === 77)).toHaveLength(1);
  });
});

describe("restore", () => {
  it("загружает недостающие записи, существующие пропускает", async () => {
    reset([title({ t: "Медведь", type: "series" })]);
    m.createItem.mockImplementation(async (it) => ({ ...(it as Title), id: Math.floor(Math.random() * 1000) + 100, h: [1, 2] }));
    const ok = await state().restore({
      items: [
        { t: "Медведь", type: "series", g: ["Драма"], ep: 1, tot: 8 },
        { t: "Шерлок", type: "series", g: ["Детектив"], ep: 0, tot: 13 },
        { t: "Дюна", type: "book", g: [], ep: 0, tot: 40, rv: [{ a: "Вы", t: "Мощно", r: 9 }], pg: 100, pgTot: 700 },
      ],
    });
    expect(ok).toBe(true);
    expect(m.createItem).toHaveBeenCalledTimes(2);
    const dune = m.createItem.mock.calls[1][0] as Record<string, unknown>;
    expect(dune.note).toBe("Мощно");
    expect("rv" in dune || "pg" in dune || "id" in dune).toBe(false);
    expect(state().items).toHaveLength(3);
    expect(state().toast).toBe("Загружено: 2, уже были: 1");
  });

  it("запись с неизвестным типом считается ошибкой, остальные грузятся", async () => {
    reset([]);
    m.createItem.mockImplementation(async (it) => ({ ...(it as Title), id: 50, h: [1, 2] }));
    const ok = await state().restore({ items: [{ t: "А", type: "podcast", g: [], ep: 0, tot: 1 }, { t: "Б", type: "movie", g: [], ep: 0, tot: 1 }] });
    expect(ok).toBe(false);
    expect(m.createItem).toHaveBeenCalledTimes(1);
    expect(state().toast).toBe("Загружено: 1, с ошибкой: 1");
  });

  it("мусор вместо копии: запросов нет", async () => {
    reset([]);
    expect(await state().restore("text")).toBe(false);
    expect(m.createItem).not.toHaveBeenCalled();
    expect(state().toast).toBe("Файл не подошёл");
  });
});

describe("load и лента", () => {
  it("load: библиотека и первая страница ленты", async () => {
    useStore.setState({ items: [], log: [], loaded: false, hydrated: false, loadError: "старая ошибка" });
    m.listItems.mockResolvedValue([title(), title({ id: 2 })]);
    m.listLog.mockResolvedValue([entry()]);
    await state().load();
    expect(state()).toMatchObject({ loaded: true, hydrated: true, loadError: null, logEnd: true });
    expect(state().items).toHaveLength(2);
    expect(m.listLog).toHaveBeenCalledWith({ limit: 20 });
  });

  it("load: полная страница ленты — есть что подгружать", async () => {
    m.listItems.mockResolvedValue([]);
    m.listLog.mockResolvedValue(Array.from({ length: 20 }, (_, i) => entry({ id: 100 - i })));
    await state().load();
    expect(state().logEnd).toBe(false);
  });

  it("load: ошибка сохраняется для баннера, страницы выходят из скелетонов", async () => {
    useStore.setState({ items: [], loaded: false, hydrated: false, loadError: null });
    m.listItems.mockRejectedValue(new ApiError(502, "Бэкенд недоступен"));
    await state().load();
    expect(state()).toMatchObject({ loaded: false, hydrated: true, loadError: "Бэкенд недоступен" });
  });

  it("ensureLoaded не запускает вторую загрузку, пока идёт первая, и после успеха", async () => {
    useStore.setState({ items: [], loaded: false, hydrated: false });
    m.listItems.mockResolvedValue([]);
    state().ensureLoaded();
    state().ensureLoaded();
    await settle();
    state().ensureLoaded();
    await settle();
    expect(m.listItems).toHaveBeenCalledTimes(1);
  });

  it("loadMoreLog: просит записи старше последней и дописывает в конец", async () => {
    reset([], [entry({ id: 30 }), entry({ id: 20 })]);
    m.listLog.mockResolvedValue([entry({ id: 10 })]);
    await state().loadMoreLog();
    expect(m.listLog).toHaveBeenCalledWith({ limit: 20, before: 20 });
    expect(state().log.map((e) => e.id)).toEqual([30, 20, 10]);
    expect(state().logEnd).toBe(true);
  });

  it("loadMoreLog: в конце ленты запросов нет", async () => {
    reset([], [entry({ id: 30 })]);
    useStore.setState({ logEnd: true });
    await state().loadMoreLog();
    expect(m.listLog).not.toHaveBeenCalled();
  });

  it("loadMoreLog: без записей с id (только временные) не запрашивает", async () => {
    reset([], [{ day: "СЕГОДНЯ", title: "X", ep: 1, time: "10:00" }]);
    await state().loadMoreLog();
    expect(m.listLog).not.toHaveBeenCalled();
  });
});

describe("восстановление из JSON-экспорта сервера", () => {
  const serverItem = (over = {}) => ({
    id: 3, title_ru: "Берсерк", title_original: "Berserk", category: "manga", genres: ["экшен"], author: "Миура", country: "Япония",
    release_year: 1989, description: null, status: "watching", current_season: null, current_episode: null, current_volume: 3,
    current_chapter: 40, total_episodes: null, total_chapters: 364, translation: null, rating: 10, comment: "заметка", poster_url: null,
    source_link: null, finished_at: null, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00", ...over,
  });

  it("записи формата API создаются как обычные тайтлы", async () => {
    reset([]);
    m.createItem.mockImplementation(async (it) => title({ id: 99, t: it.t, type: it.type }));
    const ok = await state().restore({ app: "Episodio", exported_at: "x", items: [serverItem()], log: [] });
    expect(ok).toBe(true);
    expect(m.createItem).toHaveBeenCalledTimes(1);
    expect(m.createItem.mock.calls[0][0]).toMatchObject({ t: "Берсерк", type: "manga", g: ["Экшен"], ep: 40, tot: 364, vol: 3, note: "заметка", rate: 10 });
  });

  it("копия формата интерфейса по-прежнему принимается", async () => {
    reset([]);
    m.createItem.mockResolvedValue(title({ id: 5 }));
    expect(await state().restore({ app: "Episodio", v: 1, items: [{ t: "Т", type: "series", g: [], ep: 0, tot: 8 }] })).toBe(true);
    expect(m.createItem).toHaveBeenCalledTimes(1);
  });
});

describe("ручное обогащение", () => {
  const cand = { key: "tmdb:1", source: "tmdb", extId: "1", t: "Медведь", y: 2022, g: ["Драма"], c: "США" };

  it("enrichCandidates отдаёт варианты как есть", async () => {
    reset([title()]);
    m.listCandidates.mockResolvedValue([cand]);
    expect(await state().enrichCandidates(1)).toEqual([cand]);
    expect(m.listCandidates).toHaveBeenCalledWith(1, undefined);
  });

  it("enrichCandidates передаёт выбранный источник", async () => {
    reset([title()]);
    m.listCandidates.mockResolvedValue([]);
    await state().enrichCandidates(1, "anilist");
    expect(m.listCandidates).toHaveBeenCalledWith(1, "anilist");
  });

  it("enrichApply обновляет карточку в библиотеке и возвращает заполненные поля", async () => {
    reset([title({ img: undefined, g: [] })]);
    m.applyCandidate.mockResolvedValue({ item: title({ img: "/api/backend/posters/1.jpg", g: ["Драма"] }), changed: ["poster_url", "genres"] });
    expect(await state().enrichApply(1, cand, false)).toEqual(["poster_url", "genres"]);
    expect(m.applyCandidate).toHaveBeenCalledWith(1, "tmdb", "1", false);
    expect(item()).toMatchObject({ img: "/api/backend/posters/1.jpg", g: ["Драма"] });
  });

  it("«Заменить постер» передаёт force", async () => {
    reset([title()]);
    m.applyCandidate.mockResolvedValue({ item: title(), changed: [] });
    await state().enrichApply(1, cand, true);
    expect(m.applyCandidate).toHaveBeenCalledWith(1, "tmdb", "1", true);
  });

  it("ошибка сервера уходит наверх, карточка не меняется", async () => {
    reset([title({ img: undefined })]);
    m.applyCandidate.mockRejectedValue(new ApiError(502, "Внешний сервис недоступен"));
    await expect(state().enrichApply(1, cand, false)).rejects.toMatchObject({ status: 502 });
    expect(item().img).toBeUndefined();
  });
});

describe("статистика", () => {
  const stat = (over: Partial<Stats> = {}): Stats => ({
    from: "2026-10-19",
    to: "2026-10-25",
    totalItems: 1,
    genres: [],
    countries: [],
    years: [],
    top: [],
    totals: { episodes: 0, chapters: 0, movies: 0 },
    activity: [],
    marks: { episodes: 0, chapters: 0, movies: 0 },
    ...over,
  });

  it("loadStats запрашивает текущую неделю (Пн–Вс) и кладёт ответ в стор", async () => {
    reset([title()]);
    useStore.setState({ stats: null, statsError: null });
    m.getStats.mockResolvedValue(stat({ totalItems: 5 }));
    await state().loadStats();
    const opts = m.getStats.mock.calls[0][0] as { from: string; to: string; limit: number };
    expect(opts.limit).toBe(10);
    expect(new Date(`${opts.from}T00:00:00`).getDay()).toBe(1);
    expect(new Date(`${opts.to}T00:00:00`).getDay()).toBe(0);
    expect(state().stats?.totalItems).toBe(5);
    expect(state().statsError).toBeNull();
  });

  it("ошибка: статистика остаётся прежней, текст ошибки сохраняется без тоста", async () => {
    reset([title()]);
    useStore.setState({ stats: stat({ totalItems: 7 }), statsError: null });
    m.getStats.mockRejectedValue(new ApiError(502, "Бэкенд недоступен"));
    await state().loadStats();
    expect(state().stats?.totalItems).toBe(7);
    expect(state().statsError).toBe("Бэкенд недоступен");
    expect(state().toast).toBe("");
  });

  it("успешный повтор сбрасывает ошибку", async () => {
    reset([title()]);
    useStore.setState({ stats: null, statsError: "Бэкенд недоступен" });
    m.getStats.mockResolvedValue(stat());
    await state().loadStats();
    expect(state().statsError).toBeNull();
  });

  it("устаревший ответ не затирает более новый", async () => {
    reset([title()]);
    useStore.setState({ stats: null, statsError: null });
    let release: (s: Stats) => void = () => {};
    m.getStats.mockReturnValueOnce(new Promise<Stats>((r) => (release = r)));
    m.getStats.mockResolvedValueOnce(stat({ totalItems: 2 }));
    const first = state().loadStats();
    await state().loadStats();
    release(stat({ totalItems: 1 }));
    await first;
    expect(state().stats?.totalItems).toBe(2);
  });
});
