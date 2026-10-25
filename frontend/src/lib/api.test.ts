import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  CATEGORY_FROM_API,
  CATEGORY_TO_API,
  dayLabel,
  downloadExport,
  errorMessage,
  filenameFrom,
  fromServerExport,
  ITEMS_PAGE,
  posterSrc,
  STATUS_FROM_API,
  STATUS_TO_API,
  toApiCatalogAdd,
  toApiFields,
  toCatalogResult,
  toEnrichCandidate,
  toLogEntry,
  toApiShowcaseFilter,
  toShowcase,
  toShowcaseView,
  toStats,
  toTitle,
  typeFromApi,
  type ApiCatalogResult,
  type ApiEnrichCandidate,
  type ApiShowcase,
  type ApiShowcaseView,
  type ApiStats,
  type ApiItem,
} from "./api";
import { TYPES } from "./rules";
import type { Title } from "./types";

const apiItem = (over: Partial<ApiItem> = {}): ApiItem => ({
  id: 7,
  title_ru: "Блудливая Калифорния",
  title_original: "Californication",
  category: "tv_series",
  genres: ["драма", "комедия"],
  author: null,
  country: "США",
  release_year: 2007,
  description: null,
  status: "watching",
  current_season: 7,
  current_episode: 5,
  current_volume: null,
  current_chapter: null,
  total_episodes: 12,
  total_chapters: null,
  translation: null,
  rating: null,
  comment: null,
  poster_url: null,
  source_link: null,
  finished_at: null,
  created_at: "2026-01-01T10:00:00",
  updated_at: "2026-01-02T10:00:00",
  ...over,
});

const title = (over: Partial<Title> = {}): Omit<Title, "id" | "h"> => ({
  type: "series",
  st: "watching",
  t: "Блудливая Калифорния",
  en: "Californication",
  y: 2007,
  c: "США",
  g: ["Драма", "Комедия"],
  se: 7,
  ep: 5,
  tot: 12,
  ...over,
});

describe("значения", () => {
  it("все 8 категорий интерфейса есть в БД и обратно", () => {
    expect(TYPES).toHaveLength(8);
    for (const [type] of TYPES) expect(CATEGORY_FROM_API[CATEGORY_TO_API[type]]).toBe(type);
    expect(new Set(Object.values(CATEGORY_TO_API)).size).toBe(8);
  });
  it("series ↔ tv_series, show ↔ tv_show", () => {
    expect(CATEGORY_TO_API.series).toBe("tv_series");
    expect(CATEGORY_TO_API.show).toBe("tv_show");
  });
  it("done ↔ completed, остальные статусы совпадают", () => {
    expect(STATUS_TO_API.done).toBe("completed");
    expect(STATUS_FROM_API.completed).toBe("done");
    expect(STATUS_FROM_API.watching).toBe("watching");
    expect(STATUS_FROM_API.planned).toBe("planned");
    expect(STATUS_FROM_API.dropped).toBe("dropped");
  });
});

describe("toTitle", () => {
  it("сериал: серии, сезон, жанры с заглавной", () => {
    const t = toTitle(apiItem());
    expect(t).toMatchObject({ id: 7, type: "series", st: "watching", t: "Блудливая Калифорния", en: "Californication", y: 2007, c: "США", se: 7, ep: 5, tot: 12 });
    expect(t.g).toEqual(["Драма", "Комедия"]);
  });
  it("пустые поля БД становятся значениями по умолчанию интерфейса", () => {
    const t = toTitle(apiItem({ title_original: null, country: null, release_year: null, current_episode: null, total_episodes: null, genres: [], rating: null }));
    expect(t).toMatchObject({ en: undefined, c: "—", y: 0, ep: 0, tot: 0, g: [], rate: 0 });
  });
  it("манга, книга, аудиокнига: главы и том", () => {
    for (const category of ["manga", "book", "audiobook"] as const) {
      const t = toTitle(apiItem({ category, current_episode: 99, current_chapter: 4, total_chapters: 10, current_volume: 2 }));
      expect(t).toMatchObject({ ep: 4, tot: 10, vol: 2 });
    }
  });
  it("мультсериал и ТВ-шоу считаются сериями", () => {
    expect(toTitle(apiItem({ category: "cartoon" }))).toMatchObject({ type: "cartoon", ep: 5, tot: 12 });
    expect(toTitle(apiItem({ category: "tv_show" }))).toMatchObject({ type: "show", ep: 5, tot: 12 });
  });
  it("фильм: счётчик 0/1 по статусу, прогресс из БД игнорируется", () => {
    expect(toTitle(apiItem({ category: "movie", status: "completed", current_episode: null }))).toMatchObject({ type: "movie", ep: 1, tot: 1, st: "done" });
    expect(toTitle(apiItem({ category: "movie", status: "planned" }))).toMatchObject({ ep: 0, tot: 1 });
  });
  it("автор, озвучка, ссылка, заметка и описание", () => {
    const t = toTitle(apiItem({ author: "Герберт", translation: "LostFilm", source_link: "https://x.test", comment: "Топ", description: "О чём" }));
    expect(t).toMatchObject({ author: "Герберт", tr: "LostFilm", link: "https://x.test", note: "Топ", desc: "О чём" });
  });
  it("цвет заглушки зависит только от id", () => {
    expect(toTitle(apiItem({ id: 3 })).h).toEqual(toTitle(apiItem({ id: 3, title_ru: "Другое" })).h);
  });
});

describe("неизвестная категория", () => {
  it("typeFromApi: известные совпадают с таблицей, неизвестная — запасной тип «сериал»", () => {
    expect(typeFromApi("tv_show")).toBe("show");
    expect(typeFromApi("podcast")).toBe("series");
    expect(typeFromApi("")).toBe("series");
  });
  it("toTitle не падает и считает прогресс сериями", () => {
    const t = toTitle(apiItem({ category: "podcast" as ApiItem["category"], current_episode: 3, total_episodes: 10 }));
    expect(t).toMatchObject({ type: "series", ep: 3, tot: 10 });
  });
  it("toCatalogResult не падает на неизвестной категории", () => {
    const r = toCatalogResult(apiResult({ category: "podcast" as ApiCatalogResult["category"] }));
    expect(r.type).toBe("series");
  });
});

const apiCandidate = (over: Partial<ApiEnrichCandidate> = {}): ApiEnrichCandidate => ({
  source: "tmdb",
  external_id: "1424",
  title: "Блудливая Калифорния",
  original_title: "Californication",
  year: 2007,
  poster_url: "https://image.tmdb.org/t/p/w500/x.jpg",
  genres: ["драма", "комедия"],
  country: "США",
  author: null,
  ...over,
});

describe("обогащение: адаптер", () => {
  it("toEnrichCandidate: жанры с заглавной, пустые поля — значения интерфейса", () => {
    expect(toEnrichCandidate(apiCandidate())).toEqual({
      key: "tmdb:1424",
      source: "tmdb",
      extId: "1424",
      t: "Блудливая Калифорния",
      en: "Californication",
      y: 2007,
      g: ["Драма", "Комедия"],
      c: "США",
      author: undefined,
      img: "https://image.tmdb.org/t/p/w500/x.jpg",
    });
    expect(toEnrichCandidate(apiCandidate({ year: null, country: null, poster_url: null, original_title: null, author: "Автор" }))).toMatchObject({
      y: 0,
      c: "—",
      img: undefined,
      en: undefined,
      author: "Автор",
    });
  });
});

const apiStats = (over: Partial<ApiStats> = {}): ApiStats => ({
  period_from: "2026-10-19",
  period_to: "2026-10-25",
  total_items: 3,
  genres: [{ name: "драма", items: 2, progress: 15 }],
  countries: [{ name: "США", items: 2, progress: 15 }],
  categories: [{ name: "tv_series", items: 3, progress: 15 }],
  statuses: [{ name: "watching", items: 3, progress: 15 }],
  years: [{ year: 2007, items: 2, progress: 15 }],
  top_items: [{ item_id: 7, title_ru: "Калифорния", title_original: "Californication", category: "tv_series", progress: 12 }],
  totals: { episodes: 15, chapters: 0, movies: 0 },
  activity: [{ date: "2026-10-19", count: 2 }],
  marks: { episodes: 2, chapters: 0, movies: 0 },
  ...over,
});

describe("статистика: адаптер", () => {
  it("toStats: период, жанры с заглавной, топ с типом интерфейса", () => {
    expect(toStats(apiStats())).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
      totalItems: 3,
      genres: [{ name: "Драма", items: 2, progress: 15 }],
      countries: [{ name: "США", items: 2, progress: 15 }],
      years: [{ year: 2007, items: 2, progress: 15 }],
      top: [{ id: 7, title: "Калифорния", en: "Californication", type: "series", progress: 12 }],
      totals: { episodes: 15, chapters: 0, movies: 0 },
      activity: [{ date: "2026-10-19", count: 2 }],
      marks: { episodes: 2, chapters: 0, movies: 0 },
    });
  });
  it("пустая база: пустые списки и нули", () => {
    const s = toStats(apiStats({ total_items: 0, genres: [], countries: [], years: [], top_items: [], activity: [], totals: { episodes: 0, chapters: 0, movies: 0 } }));
    expect(s).toMatchObject({ totalItems: 0, genres: [], top: [], totals: { episodes: 0, chapters: 0, movies: 0 } });
  });
  it("неизвестная категория в топе не ломает адаптер", () => {
    const s = toStats(apiStats({ top_items: [{ item_id: 1, title_ru: "X", title_original: null, category: "podcast" as ApiStats["top_items"][0]["category"], progress: 1 }] }));
    expect(s.top[0]).toMatchObject({ type: "series", en: undefined });
  });
});

const apiShowcase = (over: Partial<ApiShowcase> = {}): ApiShowcase => ({
  id: 3,
  slug: "top-anime-2026-03",
  title: "Мой топ аниме 2026, март",
  category: "anime",
  year: 2026,
  month: 3,
  max_items: 8,
  is_public: true,
  created_at: "2026-03-01T10:00:00",
  ...over,
});

const apiShowcaseView = (over: Partial<ApiShowcaseView> = {}): ApiShowcaseView => ({
  title: "Топ",
  category: "tv_series",
  year: 2026,
  month: null,
  items: [
    { title_ru: "Медведь", title_original: "The Bear", category: "tv_series", release_year: 2022, genres: ["драма"], country: "США", author: null, rating: 10, poster: "/posters/5.jpg", finished_on: "2026-03-10" },
    { title_ru: "Без всего", title_original: null, category: "podcast" as ApiShowcaseView["items"][0]["category"], release_year: null, genres: [], country: null, author: "А", rating: 7, poster: null, finished_on: null },
  ],
  ...over,
});

describe("витрины: адаптеры", () => {
  it("toShowcase: тип интерфейса, период и публичность", () => {
    expect(toShowcase(apiShowcase())).toEqual({ id: 3, slug: "top-anime-2026-03", title: "Мой топ аниме 2026, март", type: "anime", year: 2026, month: 3, max: 8, isPublic: true });
    expect(toShowcase(apiShowcase({ category: null, year: null, month: null, category_x: 1 } as Partial<ApiShowcase>))).toMatchObject({ type: "all", year: null, month: null });
    expect(toShowcase(apiShowcase({ category: "tv_series" })).type).toBe("series");
  });
  it("toApiShowcaseFilter: 'all' уходит как null, месяц без года сбрасывается, название обрезается", () => {
    expect(toApiShowcaseFilter({ title: "  Топ ", type: "all", year: 2026, month: 3, max: 4 })).toEqual({ title: "Топ", category: null, year: 2026, month: 3, max_items: 4 });
    expect(toApiShowcaseFilter({ title: "Т", type: "series", year: null, month: 5, max: 8 })).toEqual({ title: "Т", category: "tv_series", year: null, month: null, max_items: 8 });
  });
  it("toShowcaseView: карточки, жанры с заглавной, постер через прокси по умолчанию", () => {
    const view = toShowcaseView(apiShowcaseView());
    expect(view).toMatchObject({ title: "Топ", type: "series", year: 2026, month: null });
    expect(view.cards[0]).toEqual({ t: "Медведь", en: "The Bear", type: "series", y: 2022, g: ["Драма"], c: "США", author: undefined, rate: 10, img: "/api/backend/posters/5.jpg", finished: "2026-03-10" });
    expect(view.cards[1]).toMatchObject({ type: "series", y: 0, c: "—", author: "А", img: undefined, finished: undefined }); // неизвестная категория не ломает
  });
  it("toShowcaseView: адрес постера задаёт вызывающий (публичная страница)", () => {
    const view = toShowcaseView(apiShowcaseView(), (p) => (p ? `/u/me/x${p}` : undefined));
    expect(view.cards[0].img).toBe("/u/me/x/posters/5.jpg");
  });
  it("в карточке нет приватных полей", () => {
    const keys = Object.keys(toShowcaseView(apiShowcaseView()).cards[0]);
    for (const k of ["note", "link", "tr", "id", "ep", "tot", "desc"]) expect(keys).not.toContain(k);
  });
});

describe("экспорт: имя файла и формат", () => {
  it("filenameFrom: имя из заголовка, без пути и опасных символов", () => {
    expect(filenameFrom('attachment; filename="episodio-2026-10-25.xlsx"')).toBe("episodio-2026-10-25.xlsx");
    expect(filenameFrom("attachment; filename=episodio.json")).toBe("episodio.json");
    expect(filenameFrom("attachment; filename*=UTF-8''%D0%BC%D0%BE%D1%8F%20%D0%B1%D0%B0%D0%B7%D0%B0.xlsx")).toBe("моя база.xlsx");
    expect(filenameFrom('attachment; filename="../../etc/passwd"')).toBe("etcpasswd");
    expect(filenameFrom('attachment; filename="a:b*c?.xlsx"')).toBe("abc.xlsx");
    expect(filenameFrom('attachment; filename="100%.xlsx"')).toBe("100%.xlsx"); // некорректная кодировка не роняет разбор
  });
  it("filenameFrom: нет заголовка или пустое имя", () => {
    expect(filenameFrom(null)).toBeNull();
    expect(filenameFrom("attachment")).toBeNull();
    expect(filenameFrom('attachment; filename=".."')).toBeNull();
  });

  it("fromServerExport: записи сервера становятся записями интерфейса", () => {
    const server = { app: "Episodio", exported_at: "2026-10-25T10:00:00", items: [apiItem({ id: 7, genres: ["драма"] })], log: [{ id: 1 }] };
    const out = fromServerExport(server) as { items: Title[]; log?: unknown };
    expect(out.items[0]).toMatchObject({ id: 7, type: "series", t: "Блудливая Калифорния", g: ["Драма"], ep: 5, tot: 12 });
    expect(out.log).toBeUndefined(); // журнал из файла не восстанавливается
  });
  it("fromServerExport: копия интерфейса, массив и мусор возвращаются как есть", () => {
    const backup = { app: "Episodio", items: [{ t: "Т", g: [], ep: 1, tot: 2 }] };
    expect(fromServerExport(backup)).toBe(backup);
    const list = [{ t: "Т" }];
    expect(fromServerExport(list)).toBe(list);
    expect(fromServerExport(null)).toBeNull();
    expect(fromServerExport({ items: [] })).toEqual({ items: [] });
    expect(fromServerExport("x")).toBe("x");
  });
});

describe("posterSrc", () => {
  it("локальный путь идёт через прокси, внешний URL и пустое значение — как есть", () => {
    expect(posterSrc("/posters/42.jpg")).toBe("/api/backend/posters/42.jpg");
    expect(posterSrc("https://img.test/a.jpg")).toBe("https://img.test/a.jpg");
    expect(posterSrc(null)).toBeUndefined();
  });
});

describe("toApiFields", () => {
  it("сериал: серии, сезон, жанры в нижнем регистре, статус completed", () => {
    expect(toApiFields(title({ st: "done" }))).toMatchObject({
      title_ru: "Блудливая Калифорния",
      title_original: "Californication",
      category: "tv_series",
      genres: ["драма", "комедия"],
      country: "США",
      release_year: 2007,
      status: "completed",
      current_season: 7,
      current_episode: 5,
      total_episodes: 12,
      current_chapter: null,
      total_chapters: null,
    });
  });
  it("«Без жанра» не уходит в БД как жанр (на русском и английском)", () => {
    expect(toApiFields(title({ g: ["Без жанра"] })).genres).toEqual([]);
    expect(toApiFields(title({ g: ["No genre", "Драма"] })).genres).toEqual(["драма"]);
  });
  it("пустые значения уходят как null", () => {
    expect(toApiFields(title({ en: "", c: "—", y: 0, rate: 0, desc: "  ", ep: 0, tot: 0, se: 1 }))).toMatchObject({
      title_original: null,
      country: null,
      release_year: null,
      rating: null,
      description: null,
      current_episode: null,
      total_episodes: null,
      current_season: null,
    });
  });
  it("сезон 1 пишется, если просмотр начат", () => {
    expect(toApiFields(title({ se: 1, ep: 2 })).current_season).toBe(1);
  });
  it("книга: главы и том, серий нет", () => {
    const f = toApiFields(title({ type: "book", ep: 3, tot: 10, vol: 2, author: " Герберт " }));
    expect(f).toMatchObject({ category: "book", current_chapter: 3, total_chapters: 10, current_volume: 2, author: "Герберт", current_episode: null, total_episodes: null, current_season: null });
  });
  it("том не пишется у сериалов", () => {
    expect(toApiFields(title({ vol: 3 })).current_volume).toBeNull();
  });
  it("фильм: прогресса в БД нет, завершённость только статусом", () => {
    expect(toApiFields(title({ type: "movie", st: "done", ep: 1, tot: 1, se: 1 }))).toMatchObject({
      category: "movie",
      status: "completed",
      current_episode: null,
      total_episodes: null,
      current_chapter: null,
      current_season: null,
    });
  });
  it("оценка, заметка, озвучка, ссылка", () => {
    expect(toApiFields(title({ rate: 9, note: " Топ ", tr: "LostFilm", link: "https://x.test" }))).toMatchObject({ rating: 9, comment: "Топ", translation: "LostFilm", source_link: "https://x.test" });
  });
  it("не содержит служебных полей и постера", () => {
    const f = toApiFields(title({ img: "data:image/png;base64,xx" })) as Record<string, unknown>;
    for (const key of ["id", "poster_url", "finished_at", "created_at", "updated_at", "img"]) expect(key in f).toBe(false);
  });
  it("круг: БД → интерфейс → БД сохраняет поля", () => {
    const a = apiItem({ genres: ["фэнтези"], rating: 8, comment: "ок", current_season: 2 });
    const t = toTitle(a);
    const { id: _id, h: _h, ...rest } = t;
    expect(toApiFields(rest)).toMatchObject({ title_ru: a.title_ru, genres: a.genres, rating: 8, comment: "ок", current_season: 2, current_episode: 5, total_episodes: 12 });
  });
});

describe("журнал", () => {
  const now = new Date(2026, 9, 24, 12, 0);
  it("подписи дней", () => {
    expect(dayLabel(new Date(2026, 9, 24, 1, 0), now)).toBe("СЕГОДНЯ");
    expect(dayLabel(new Date(2026, 9, 23, 23, 59), now)).toBe("ВЧЕРА");
    expect(dayLabel(new Date(2026, 9, 22, 10, 0), now)).toBe("2 ДНЯ НАЗАД");
    expect(dayLabel(new Date(2026, 9, 20, 10, 0), now)).toBe("4 ДНЯ НАЗАД");
    expect(dayLabel(new Date(2026, 9, 19, 10, 0), now)).toBe("5 ДНЕЙ НАЗАД");
    expect(dayLabel(new Date(2026, 9, 10, 10, 0), now)).toBe("10 ОКТ");
  });
  it("запись: серия, глава, фильм", () => {
    const base = { id: 3, item_id: 1, title_ru: "Фрирен", title_original: null, category: "anime" as const, number: 18, logged_at: "2026-10-24T22:40:05.123" };
    expect(toLogEntry({ ...base, unit: "episode" }, now)).toEqual({ id: 3, day: "СЕГОДНЯ", title: "Фрирен", ep: 18, time: "22:40", u: "ep" });
    expect(toLogEntry({ ...base, unit: "chapter" }, now).u).toBe("ch");
    expect(toLogEntry({ ...base, unit: "movie", number: 1 }, now)).toMatchObject({ u: "film", ep: 1 });
  });
});

const apiResult = (over: Partial<ApiCatalogResult> = {}): ApiCatalogResult => ({
  source: "shikimori",
  external_id: "anime:52991",
  category: "anime",
  title: "Фрирен",
  original_title: "Sousou no Frieren",
  year: 2023,
  poster_url: "https://shikimori.io/system/animes/original/52991.jpg",
  genres: ["фэнтези", "драма"],
  country: null,
  author: null,
  ...over,
});

describe("каталог: адаптеры", () => {
  it("toCatalogResult: тип интерфейса, жанры с заглавной, пустые поля", () => {
    expect(toCatalogResult(apiResult())).toEqual({
      key: "shikimori:anime:52991:anime",
      source: "shikimori",
      extId: "anime:52991",
      type: "anime",
      t: "Фрирен",
      en: "Sousou no Frieren",
      y: 2023,
      g: ["Фэнтези", "Драма"],
      c: "—",
      author: undefined,
      img: "https://shikimori.io/system/animes/original/52991.jpg",
    });
  });
  it("оценка источника: число или пусто", () => {
    expect(toCatalogResult(apiResult({ rating: 8.6 })).rating).toBe(8.6);
    expect(toCatalogResult(apiResult({ rating: null })).rating).toBeUndefined();
    expect(toCatalogResult(apiResult()).rating).toBeUndefined();
  });
  it("tv_series → series, tv_show → show; без года и постера", () => {
    expect(toCatalogResult(apiResult({ category: "tv_series", year: null, poster_url: null })).type).toBe("series");
    expect(toCatalogResult(apiResult({ category: "tv_show" })).type).toBe("show");
    expect(toCatalogResult(apiResult({ year: null, poster_url: null }))).toMatchObject({ y: 0, img: undefined });
  });
  it("ключ различает одну запись в разных категориях", () => {
    expect(toCatalogResult(apiResult({ category: "tv_series" })).key).not.toBe(toCatalogResult(apiResult({ category: "cartoon" })).key);
  });
  it("toApiCatalogAdd: обратное преобразование для сервера", () => {
    const r = toCatalogResult(apiResult({ category: "tv_series", country: "США", author: "Автор" }));
    expect(toApiCatalogAdd(r, "done")).toEqual({
      source: "shikimori",
      external_id: "anime:52991",
      category: "tv_series",
      status: "completed",
      title: "Фрирен",
      original_title: "Sousou no Frieren",
      year: 2023,
      poster_url: "https://shikimori.io/system/animes/original/52991.jpg",
      genres: ["фэнтези", "драма"],
      country: "США",
      author: "Автор",
    });
  });
  it("toApiCatalogAdd: пустые значения уходят как null", () => {
    const r = toCatalogResult(apiResult({ original_title: null, year: null, poster_url: null, genres: [] }));
    expect(toApiCatalogAdd(r, "planned")).toMatchObject({ original_title: null, year: null, poster_url: null, genres: [], country: null, author: null, status: "planned" });
  });
});

describe("errorMessage", () => {
  it("строка detail", () => expect(errorMessage({ detail: "Элемент не найден" }, 404)).toBe("Элемент не найден"));
  it("список ошибок валидации", () => expect(errorMessage({ detail: [{ msg: "плохо" }, { msg: "очень" }] }, 422)).toBe("плохо; очень"));
  it("без detail", () => expect(errorMessage(null, 500)).toBe("Ошибка сервера (500)"));
});

describe("клиент", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const stub = (res: Response | Error) => {
    // clone: тело Response можно прочитать только раз, а заглушка может вызываться несколько раз
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
      if (res instanceof Error) throw res;
      return res.clone();
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  it("listItems запрашивает список и преобразует записи", async () => {
    const fn = stub(respond(200, [apiItem()]));
    const items = await api.listItems();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe(`/api/backend/items/?limit=${ITEMS_PAGE}&offset=0`);
    expect(items[0]).toMatchObject({ id: 7, type: "series" });
  });

  it("listItems читает страницами до неполной и не теряет записи сверх одной страницы", async () => {
    const full = Array.from({ length: ITEMS_PAGE }, (_, i) => apiItem({ id: i + 1 }));
    const tail = [apiItem({ id: ITEMS_PAGE + 1 }), apiItem({ id: ITEMS_PAGE + 2 })];
    const fn = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("offset=0") ? full : tail), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    const items = await api.listItems();
    expect(items).toHaveLength(ITEMS_PAGE + 2);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      `/api/backend/items/?limit=${ITEMS_PAGE}&offset=0`,
      `/api/backend/items/?limit=${ITEMS_PAGE}&offset=${ITEMS_PAGE}`,
    ]);
  });

  it("listItems: точно целое число страниц — последний пустой запрос завершает чтение", async () => {
    const full = Array.from({ length: ITEMS_PAGE }, (_, i) => apiItem({ id: i + 1 }));
    const fn = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("offset=0") ? full : []), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    expect(await api.listItems()).toHaveLength(ITEMS_PAGE);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("запрос получает сигнал таймаута: 15 с обычный, 60 с для загрузки файла", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    stub(respond(200, apiItem()));
    await api.getItem(7);
    await api.uploadPoster(7, new File(["x"], "p.png", { type: "image/png" }));
    expect(spy.mock.calls.map((c) => c[0])).toEqual([15_000, 60_000]);
    spy.mockRestore();
  });

  it("зависший сервер: ApiError 0 с сообщением про ожидание", async () => {
    stub(new DOMException("The operation timed out.", "TimeoutError"));
    const err = await api.getItem(7).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: "Сервер не ответил вовремя" });
  });

  it("createItem отправляет POST с полями бэкенда", async () => {
    const fn = stub(respond(201, apiItem()));
    await api.createItem(title());
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ category: "tv_series", genres: ["драма", "комедия"] });
  });

  it("updateItem отправляет PATCH на нужный id", async () => {
    const fn = stub(respond(200, apiItem()));
    await api.updateItem(7, title({ st: "done" }));
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string).status).toBe("completed");
  });

  it("progress возвращает карточку и запись журнала", async () => {
    const entry = { id: 1, item_id: 7, title_ru: "X", title_original: null, category: "tv_series", unit: "episode", number: 6, logged_at: "2026-10-24T10:00:00" };
    const fn = stub(respond(200, { item: apiItem({ current_episode: 6 }), entry }));
    const r = await api.progress(7, 1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/7/progress");
    expect(JSON.parse(init.body as string)).toEqual({ delta: 1 });
    expect(r.item.ep).toBe(6);
    expect(r.entry).toMatchObject({ id: 1, ep: 6, u: "ep" });
  });

  it("progress: при пустом журнале запись null", async () => {
    stub(respond(200, { item: apiItem(), entry: null }));
    expect((await api.progress(7, -1)).entry).toBeNull();
  });

  it("listLog передаёт limit и before", async () => {
    const fn = stub(respond(200, []));
    await api.listLog({ limit: 20, before: 55 });
    expect(fn.mock.calls[0][0]).toBe("/api/backend/log?limit=20&before=55");
    await api.listLog();
    expect(fn.mock.calls[1][0]).toBe("/api/backend/log");
  });

  it("listGenres приводит жанры к заглавной букве", async () => {
    stub(respond(200, ["драма", "экшен"]));
    expect(await api.listGenres()).toEqual(["Драма", "Экшен"]);
  });

  it("searchCatalog: запрос, категория и преобразование результатов", async () => {
    const fn = stub(respond(200, { results: [apiResult()], errors: ["TMDB не настроен"] }));
    const r = await api.searchCatalog("Фрирен", "series", 5);
    const [url] = fn.mock.calls[0] as unknown as [string];
    const u = new URL(url, "http://x");
    expect(u.pathname).toBe("/api/backend/catalog/search");
    expect(u.searchParams.get("q")).toBe("Фрирен");
    expect(u.searchParams.get("category")).toBe("tv_series");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(r.errors).toEqual(["TMDB не настроен"]);
    expect(r.results[0]).toMatchObject({ t: "Фрирен", type: "anime", g: ["Фэнтези", "Драма"] });
  });

  it("searchCatalog без типа не шлёт category", async () => {
    const fn = stub(respond(200, { results: [], errors: [] }));
    await api.searchCatalog("Dune");
    expect(new URL(fn.mock.calls[0][0], "http://x").searchParams.has("category")).toBe(false);
  });

  it("searchCatalog: 503 источника — ApiError с текстом", async () => {
    stub(respond(503, { detail: "Обогащение недоступно: не задан TMDB_API_KEY" }));
    await expect(api.searchCatalog("Dune", "movie")).rejects.toMatchObject({ status: 503, message: "Обогащение недоступно: не задан TMDB_API_KEY" });
  });

  it("addFromCatalog: POST /items/from-catalog и карточка из ответа", async () => {
    const fn = stub(respond(201, apiItem({ id: 33, title_ru: "Фрирен", category: "anime", poster_url: "/posters/33.jpg" })));
    const t = await api.addFromCatalog(toCatalogResult(apiResult()), "watching");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/from-catalog");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ source: "shikimori", external_id: "anime:52991", category: "anime", status: "watching", title: "Фрирен" });
    expect(t).toMatchObject({ id: 33, img: "/api/backend/posters/33.jpg" });
  });

  it("addFromCatalog: дубликат — ApiError 409", async () => {
    stub(respond(409, { detail: "Уже в библиотеке: Фрирен" }));
    await expect(api.addFromCatalog(toCatalogResult(apiResult()), "planned")).rejects.toMatchObject({ status: 409, message: "Уже в библиотеке: Фрирен" });
  });

  it("listCandidates: GET вариантов, ответ в типах интерфейса, таймаут 45 с", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const fn = stub(respond(200, [apiCandidate()]));
    const list = await api.listCandidates(7);
    expect(fn.mock.calls[0][0]).toBe("/api/backend/items/7/enrich/candidates");
    expect(list[0]).toMatchObject({ source: "tmdb", extId: "1424", g: ["Драма", "Комедия"] });
    expect(spy).toHaveBeenCalledWith(45_000);
    spy.mockRestore();
  });

  it("applyCandidate: POST с источником и внешним id, без force по умолчанию", async () => {
    const fn = stub(respond(200, { item: apiItem({ poster_url: "/posters/7.jpg" }), changed: ["poster_url", "genres"] }));
    const r = await api.applyCandidate(7, "tmdb", "1424");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/7/enrich/apply");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ source: "tmdb", external_id: "1424" });
    expect(r.changed).toEqual(["poster_url", "genres"]);
    expect(r.item.img).toBe("/api/backend/posters/7.jpg");
  });

  it("applyCandidate: force=true уходит в адрес запроса", async () => {
    const fn = stub(respond(200, { item: apiItem(), changed: [] }));
    await api.applyCandidate(7, "tmdb", "1424", true);
    expect(fn.mock.calls[0][0]).toBe("/api/backend/items/7/enrich/apply?force=true");
  });

  it("обогащение: коды 400, 404, 502, 503 становятся ApiError с текстом сервера", async () => {
    const cases: [number, string][] = [
      [400, "Категория не поддерживается"],
      [404, "Кандидат не найден"],
      [502, "Внешний сервис недоступен"],
      [503, "Обогащение недоступно: нет ключа"],
    ];
    for (const [status, detail] of cases) {
      stub(respond(status, { detail }));
      await expect(api.applyCandidate(7, "tmdb", "1")).rejects.toMatchObject({ status, message: detail });
      await expect(api.listCandidates(7)).rejects.toMatchObject({ status, message: detail });
    }
  });

  it("getStats: период и лимит уходят в запрос, ответ в типах интерфейса", async () => {
    const fn = stub(respond(200, apiStats()));
    const s = await api.getStats({ from: "2026-10-19", to: "2026-10-25", limit: 10 });
    expect(fn.mock.calls[0][0]).toBe("/api/backend/stats?from=2026-10-19&to=2026-10-25&limit=10");
    expect(s.top[0]).toMatchObject({ id: 7, type: "series" });
  });

  it("getStats без параметров не добавляет строку запроса", async () => {
    const fn = stub(respond(200, apiStats()));
    await api.getStats();
    expect(fn.mock.calls[0][0]).toBe("/api/backend/stats");
  });

  it("getStats: ошибка периода 422 приходит с текстом сервера", async () => {
    stub(respond(422, { detail: "Начало периода позже его конца" }));
    await expect(api.getStats({ from: "2026-10-25", to: "2026-10-19" })).rejects.toMatchObject({ status: 422, message: "Начало периода позже его конца" });
  });

  it("popularCatalog: категория и лимит в запросе, ответ в типах интерфейса", async () => {
    const fn = stub(respond(200, { results: [{ ...apiResult({ category: "tv_series", rating: 8.1 }) }], errors: ["TMDB недоступен"] }));
    const r = await api.popularCatalog("series", 12);
    expect(fn.mock.calls[0][0]).toBe("/api/backend/catalog/popular?category=tv_series&limit=12");
    expect(r.results[0]).toMatchObject({ type: "series", rating: 8.1 });
    expect(r.errors).toEqual(["TMDB недоступен"]);
  });

  it("источник уходит в запросы: поиск, подборка и варианты обогащения", async () => {
    const fn = stub(respond(200, { results: [], errors: [] }));
    await api.searchCatalog("Фрирен", "anime", 5, "anilist");
    expect(fn.mock.calls[0][0]).toBe("/api/backend/catalog/search?q=%D0%A4%D1%80%D0%B8%D1%80%D0%B5%D0%BD&category=anime&source=anilist&limit=5");
    await api.popularCatalog("manga", 12, "anilist");
    expect(fn.mock.calls[1][0]).toBe("/api/backend/catalog/popular?category=manga&source=anilist&limit=12");
    stub(respond(200, []));
    const cfn = stub(respond(200, []));
    await api.listCandidates(7, "anilist");
    expect(cfn.mock.calls[0][0]).toBe("/api/backend/items/7/enrich/candidates?source=anilist");
    await api.listCandidates(7);
    expect(cfn.mock.calls[1][0]).toBe("/api/backend/items/7/enrich/candidates");
  });

  it("popularCatalog без типа не шлёт category; 503 приходит с текстом сервера", async () => {
    const fn = stub(respond(200, { results: [], errors: [] }));
    await api.popularCatalog();
    expect(fn.mock.calls[0][0]).toBe("/api/backend/catalog/popular");
    stub(respond(503, { detail: "Не задан TMDB_API_KEY" }));
    await expect(api.popularCatalog("movie")).rejects.toMatchObject({ status: 503, message: "Не задан TMDB_API_KEY" });
  });

  it("витрины: список, создание, частичное изменение, удаление", async () => {
    const fn = stub(respond(200, [apiShowcase()]));
    expect((await api.listShowcases())[0].slug).toBe("top-anime-2026-03");
    expect(fn.mock.calls[0][0]).toBe("/api/backend/showcases");

    const post = stub(respond(201, apiShowcase({ is_public: false })));
    const created = await api.createShowcase({ title: " Топ ", type: "anime", year: 2026, month: 3, max: 8 });
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/showcases");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Топ", category: "anime", year: 2026, month: 3, max_items: 8, is_public: false });
    expect(created.isPublic).toBe(false);

    const patch = stub(respond(200, apiShowcase()));
    await api.updateShowcase(3, { isPublic: true });
    const [purl, pinit] = patch.mock.calls[0] as unknown as [string, RequestInit];
    expect(purl).toBe("/api/backend/showcases/3");
    expect(pinit.method).toBe("PATCH");
    expect(JSON.parse(pinit.body as string)).toEqual({ is_public: true }); // только переданное
    await api.updateShowcase(3, { type: "all", month: null, max: 4, title: " Н " });
    expect(JSON.parse((patch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ category: null, month: null, max_items: 4, title: "Н" });

    const del = stub(respond(204));
    await api.deleteShowcase(3);
    expect(del.mock.calls[0][0]).toBe("/api/backend/showcases/3");
  });

  it("витрины: предпросмотр и ошибки сервера (409 занятый адрес, 422)", async () => {
    const fn = stub(respond(200, apiShowcaseView()));
    const view = await api.previewShowcase({ title: "Т", type: "series", year: 2026, month: null, max: 4 });
    expect(fn.mock.calls[0][0]).toBe("/api/backend/showcases/preview");
    expect(view.cards).toHaveLength(2);
    stub(respond(409, { detail: "Адрес «aaa» уже занят" }));
    await expect(api.updateShowcase(1, { slug: "aaa" })).rejects.toMatchObject({ status: 409, message: "Адрес «aaa» уже занят" });
    stub(respond(422, { detail: "Месяц задаётся только вместе с годом" }));
    await expect(api.createShowcase({ title: "Т", type: "all", year: 2026, month: 1, max: 8 })).rejects.toMatchObject({ status: 422 });
  });

  it("downloadExport: формат в запросе, файл и имя из заголовка, таймаут 60 с", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const res = new Response("PK-binary", { status: 200, headers: { "content-disposition": 'attachment; filename="episodio-2026-10-25.xlsx"' } });
    const fn = stub(res);
    const out = await downloadExport("xlsx");
    expect(fn.mock.calls[0][0]).toBe("/api/backend/export?format=xlsx");
    expect(out.filename).toBe("episodio-2026-10-25.xlsx");
    expect(await out.blob.text()).toBe("PK-binary");
    expect(spy).toHaveBeenCalledWith(60_000);
    spy.mockRestore();
  });

  it("downloadExport: без заголовка имя строится из даты и формата", async () => {
    stub(new Response("{}", { status: 200 }));
    expect((await downloadExport("json")).filename).toMatch(/^episodio-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("downloadExport: ошибки сервера, обрыв связи и зависание", async () => {
    stub(respond(502, { detail: "Бэкенд недоступен" }));
    await expect(downloadExport("xlsx")).rejects.toMatchObject({ status: 502, message: "Бэкенд недоступен" });
    stub(new Response("не json", { status: 500 }));
    await expect(downloadExport("xlsx")).rejects.toMatchObject({ status: 500, message: "Ошибка сервера (500)" });
    stub(new TypeError("fetch failed"));
    await expect(downloadExport("json")).rejects.toMatchObject({ status: 0, message: "Нет связи с сервером" });
    stub(new DOMException("timed out", "TimeoutError"));
    await expect(downloadExport("json")).rejects.toMatchObject({ status: 0, message: "Сервер не ответил вовремя" });
  });

  it("deleteItem принимает 204", async () => {
    stub(respond(204));
    await expect(api.deleteItem(7)).resolves.toBeUndefined();
  });

  it("uploadPoster шлёт файл полем file", async () => {
    const fn = stub(respond(200, apiItem({ poster_url: "/posters/7.jpg" })));
    const t = await api.uploadPoster(7, new File(["x"], "p.png", { type: "image/png" }));
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/backend/items/7/poster");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(t.img).toBe("/api/backend/posters/7.jpg");
  });

  it("ошибка бэкенда становится ApiError с текстом", async () => {
    stub(respond(404, { detail: "Элемент не найден" }));
    await expect(api.getItem(1)).rejects.toMatchObject({ name: "ApiError", status: 404, message: "Элемент не найден" });
  });

  it("нет сети: ApiError со статусом 0", async () => {
    stub(new TypeError("fetch failed"));
    const err = await api.listItems().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("409 и 502 тоже превращаются в ошибку", async () => {
    stub(respond(409, { detail: "Всё уже отмечено" }));
    await expect(api.progress(1, 1)).rejects.toMatchObject({ status: 409 });
    stub(respond(502, { detail: "Бэкенд недоступен" }));
    await expect(api.listItems()).rejects.toMatchObject({ status: 502 });
  });
});
