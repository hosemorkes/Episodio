/**
 * Слой данных: связь модели интерфейса (`Title`, `LogEntry`) с FastAPI.
 * Адаптеры (toTitle, toApiFields, toLogEntry) — чистые функции, клиент (`api`) ходит на /api/backend,
 * откуда запрос уходит в FastAPI вместе с X-API-Key. Компоненты сюда напрямую не обращаются.
 */
import { hasSeasons, isReading } from "./rules";
import type { CatalogResult, LogEntry, LogUnit, Title, TitleStatus, TitleType } from "./types";

// ---------- Форма данных бэкенда (backend/schemas.py) ----------

export type ApiCategory = "anime" | "cartoon" | "tv_series" | "movie" | "tv_show" | "manga" | "book" | "audiobook";
export type ApiStatus = "watching" | "completed" | "planned" | "dropped";

export interface ApiItem {
  id: number;
  title_ru: string;
  title_original: string | null;
  category: ApiCategory;
  genres: string[];
  author: string | null;
  country: string | null;
  release_year: number | null;
  description: string | null;
  status: ApiStatus;
  current_season: number | null;
  current_episode: number | null;
  current_volume: number | null;
  current_chapter: number | null;
  total_episodes: number | null;
  total_chapters: number | null;
  translation: string | null;
  rating: number | null;
  comment: string | null;
  poster_url: string | null;
  source_link: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Поля, которые интерфейс записывает в бэкенд (постер грузится отдельно, finished_at ставит БД) */
export type ApiFields = Partial<Omit<ApiItem, "id" | "poster_url" | "finished_at" | "created_at" | "updated_at">>;

export interface ApiLogEntry {
  id: number;
  item_id: number;
  title_ru: string;
  title_original: string | null;
  category: ApiCategory;
  unit: "episode" | "chapter" | "movie";
  number: number;
  logged_at: string;
}

export interface ApiProgress {
  item: ApiItem;
  entry: ApiLogEntry | null;
}

// ---------- Значения ----------

export const CATEGORY_TO_API: Record<TitleType, ApiCategory> = {
  anime: "anime",
  cartoon: "cartoon",
  series: "tv_series",
  movie: "movie",
  show: "tv_show",
  manga: "manga",
  book: "book",
  audiobook: "audiobook",
};

export const CATEGORY_FROM_API = Object.fromEntries(Object.entries(CATEGORY_TO_API).map(([k, v]) => [v, k])) as Record<ApiCategory, TitleType>;

export const STATUS_TO_API: Record<TitleStatus, ApiStatus> = {
  watching: "watching",
  planned: "planned",
  done: "completed",
  dropped: "dropped",
};

export const STATUS_FROM_API = Object.fromEntries(Object.entries(STATUS_TO_API).map(([k, v]) => [v, k])) as Record<ApiStatus, TitleStatus>;

const LOG_UNIT: Record<ApiLogEntry["unit"], LogUnit> = { episode: "ep", chapter: "ch", movie: "film" };

/** Заглушка из формы «Новый тайтл» (на русском или английском): в БД жанром не является */
const isNoGenre = (g: string) => g === "Без жанра" || g === "No genre";

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Прогресс считается сериями (anime, cartoon, series, show) или главами (manga, book, audiobook); у фильма его нет */
const kindOf = (type: TitleType) => (type === "movie" ? "movie" : isReading(type) ? "chapter" : "episode");

/** Постер из БД лежит по относительному пути (/posters/42.jpg): отдаём его через прокси, внешние URL не трогаем */
export function posterSrc(url: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/posters/") ? `/api/backend${url}` : url;
}

/** Оттенки заглушки постера из id: у БД их нет, а цвет не должен меняться между загрузками */
export function hueOf(id: number): [number, number] {
  const h = (id * 47) % 360;
  return [h, (h + 40) % 360];
}

// ---------- БД -> интерфейс ----------

export function toTitle(a: ApiItem): Title {
  const type = CATEGORY_FROM_API[a.category];
  const kind = kindOf(type);
  const st = STATUS_FROM_API[a.status];
  // Фильм: в БД прогресса нет, счётчик 0/1 строится по статусу
  const ep = kind === "movie" ? (st === "done" ? 1 : 0) : ((kind === "chapter" ? a.current_chapter : a.current_episode) ?? 0);
  const tot = kind === "movie" ? 1 : ((kind === "chapter" ? a.total_chapters : a.total_episodes) ?? 0);

  return {
    id: a.id,
    type,
    st,
    t: a.title_ru,
    en: a.title_original ?? undefined,
    desc: a.description ?? undefined,
    img: posterSrc(a.poster_url),
    y: a.release_year ?? 0,
    c: a.country ?? "—",
    g: a.genres.map(capitalize),
    se: a.current_season ?? undefined,
    ep,
    tot,
    vol: a.current_volume ?? undefined,
    author: a.author ?? undefined,
    tr: a.translation ?? undefined,
    link: a.source_link ?? undefined,
    rate: a.rating ?? 0,
    note: a.comment ?? undefined,
    h: hueOf(a.id),
  };
}

// ---------- Интерфейс -> БД ----------

/**
 * Все редактируемые поля карточки в формате бэкенда (для POST и для PATCH).
 * Пустое значение уходит как null: «нет оценки» (0), «—» вместо страны, заглушка «Без жанра» и нулевой прогресс.
 */
export function toApiFields(it: Omit<Title, "id" | "h">): ApiFields {
  const kind = kindOf(it.type);
  const progress = it.ep > 0 ? it.ep : null;
  const total = it.tot > 0 ? it.tot : null;
  const country = it.c.trim();

  return {
    title_ru: it.t.trim(),
    title_original: it.en?.trim() || null,
    category: CATEGORY_TO_API[it.type],
    genres: it.g.filter((g) => !isNoGenre(g)).map((g) => g.trim().toLowerCase()).filter(Boolean),
    author: it.author?.trim() || null,
    country: country && country !== "—" ? country : null,
    release_year: it.y > 0 ? it.y : null,
    description: it.desc?.trim() || null,
    status: STATUS_TO_API[it.st],
    // Сезон 1 без начатого просмотра — значение по умолчанию формы, в БД его не пишем
    current_season: hasSeasons(it.type) && it.se && (it.se > 1 || it.ep > 0) ? it.se : null,
    current_episode: kind === "episode" ? progress : null,
    total_episodes: kind === "episode" ? total : null,
    current_chapter: kind === "chapter" ? progress : null,
    total_chapters: kind === "chapter" ? total : null,
    current_volume: isReading(it.type) && it.vol && it.vol > 0 ? it.vol : null,
    translation: it.tr?.trim() || null,
    rating: it.rate && it.rate > 0 ? it.rate : null,
    comment: it.note?.trim() || null,
    source_link: it.link?.trim() || null,
  };
}

// ---------- Каталог (живой поиск) ----------

export interface ApiCatalogResult {
  source: string;
  external_id: string;
  category: ApiCategory;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_url: string | null;
  genres: string[];
  country: string | null;
  author: string | null;
}

export interface ApiCatalogSearch {
  results: ApiCatalogResult[];
  errors: string[];
}

export function toCatalogResult(a: ApiCatalogResult): CatalogResult {
  return {
    key: `${a.source}:${a.external_id}:${a.category}`,
    source: a.source,
    extId: a.external_id,
    type: CATEGORY_FROM_API[a.category],
    t: a.title,
    en: a.original_title ?? undefined,
    y: a.year ?? 0,
    g: a.genres.map(capitalize),
    c: a.country ?? "—",
    author: a.author ?? undefined,
    img: a.poster_url ?? undefined,
  };
}

/** Тело POST /items/from-catalog: поля берутся из результата поиска, как их вернул сервер */
export function toApiCatalogAdd(r: CatalogResult, st: TitleStatus) {
  return {
    source: r.source,
    external_id: r.extId,
    category: CATEGORY_TO_API[r.type],
    status: STATUS_TO_API[st],
    title: r.t,
    original_title: r.en || null,
    year: r.y > 0 ? r.y : null,
    poster_url: r.img ?? null,
    genres: r.g.map((g) => g.trim().toLowerCase()).filter(Boolean),
    country: r.c && r.c !== "—" ? r.c : null,
    author: r.author ?? null,
  };
}

// ---------- Журнал ----------

/** Подпись дня для ленты: СЕГОДНЯ, ВЧЕРА, «N ДНЯ/ДНЕЙ НАЗАД» (до недели), дальше дата «12 ОКТ» */
export function dayLabel(at: Date, now: Date): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days <= 0) return "СЕГОДНЯ";
  if (days === 1) return "ВЧЕРА";
  if (days < 7) return `${days} ${days < 5 ? "ДНЯ" : "ДНЕЙ"} НАЗАД`;
  const months = ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК"];
  return `${at.getDate()} ${months[at.getMonth()]}`;
}

/** Время в БД хранится без часового пояса (серверное локальное), поэтому строку читаем как локальное время */
export function toLogEntry(a: ApiLogEntry, now = new Date()): LogEntry {
  const at = new Date(a.logged_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id: a.id,
    day: dayLabel(at, now),
    title: a.title_ru,
    ep: a.number,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    u: LOG_UNIT[a.unit],
  };
}

// ---------- Клиент ----------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/backend";

/** Текст ошибки из ответа FastAPI: detail — строка или список ошибок валидации */
export function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d as { msg?: unknown })?.msg).filter((m): m is string => typeof m === "string");
    if (msgs.length) return msgs.join("; ");
  }
  return `Ошибка сервера (${status})`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status));
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  /** Вся библиотека, свежеобновлённые первыми */
  listItems: async (): Promise<Title[]> => (await call<ApiItem[]>("/items/?limit=500")).map(toTitle),
  getItem: async (id: number): Promise<Title> => toTitle(await call<ApiItem>(`/items/${id}`)),
  createItem: async (it: Omit<Title, "id" | "h">): Promise<Title> => toTitle(await call<ApiItem>("/items/", json("POST", toApiFields(it)))),
  updateItem: async (id: number, it: Omit<Title, "id" | "h">): Promise<Title> => toTitle(await call<ApiItem>(`/items/${id}`, json("PATCH", toApiFields(it)))),
  /** Частичное обновление: передаются только перечисленные поля бэкенда */
  patchItem: async (id: number, fields: ApiFields): Promise<Title> => toTitle(await call<ApiItem>(`/items/${id}`, json("PATCH", fields))),
  deleteItem: (id: number) => call<void>(`/items/${id}`, { method: "DELETE" }),

  /** «+1» или «−1» серия/глава: бэкенд сам меняет статус и ведёт журнал */
  progress: async (id: number, delta: 1 | -1): Promise<{ item: Title; entry: LogEntry | null }> => {
    const r = await call<ApiProgress>(`/items/${id}/progress`, json("POST", { delta }));
    return { item: toTitle(r.item), entry: r.entry ? toLogEntry(r.entry) : null };
  },

  /** Лента: свежие первыми; before — id последней записи прошлой страницы */
  listLog: async (opts: { limit?: number; before?: number } = {}): Promise<LogEntry[]> => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", String(opts.before));
    const now = new Date();
    return (await call<ApiLogEntry[]>(`/log${q.size ? `?${q}` : ""}`)).map((e) => toLogEntry(e, now));
  },

  /** Жанры из БД для фильтра (с заглавной буквы) */
  listGenres: async (): Promise<string[]> => (await call<string[]>("/genres")).map(capitalize),

  /** Живой поиск по внешним каталогам; без type ищет по основным категориям. errors — недоступные источники */
  searchCatalog: async (q: string, type?: TitleType, limit?: number): Promise<{ results: CatalogResult[]; errors: string[] }> => {
    const params = new URLSearchParams({ q });
    if (type) params.set("category", CATEGORY_TO_API[type]);
    if (limit) params.set("limit", String(limit));
    const r = await call<ApiCatalogSearch>(`/catalog/search?${params}`);
    return { results: r.results.map(toCatalogResult), errors: r.errors };
  },
  /** Добавляет найденный тайтл в библиотеку (сервер сам скачает постер); дубликат — ApiError 409 */
  addFromCatalog: async (r: CatalogResult, st: TitleStatus): Promise<Title> =>
    toTitle(await call<ApiItem>("/items/from-catalog", json("POST", toApiCatalogAdd(r, st)))),

  uploadPoster: async (id: number, file: File): Promise<Title> => {
    const form = new FormData();
    form.append("file", file);
    return toTitle(await call<ApiItem>(`/items/${id}/poster`, { method: "POST", body: form }));
  },
  deletePoster: async (id: number): Promise<Title> => toTitle(await call<ApiItem>(`/items/${id}/poster`, { method: "DELETE" })),
};
