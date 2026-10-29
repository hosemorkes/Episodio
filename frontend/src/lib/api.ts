/**
 * Слой данных: связь модели интерфейса (`Title`, `LogEntry`) с FastAPI.
 * Адаптеры (toTitle, toApiFields, toLogEntry) — чистые функции, клиент (`api`) ходит на /api/backend,
 * откуда запрос уходит в FastAPI вместе с X-API-Key. Компоненты сюда напрямую не обращаются.
 */
import { hasSeasons, isReading } from "./rules";
import { createSseParser, parseAiEvent, type AiStreamEvent } from "./sse";
import type { CatalogResult, EnrichCandidate, LogEntry, LogUnit, Showcase, ShowcaseDraft, ShowcaseView, Stats, StatsMarks, StatsRow, Title, TitleStatus, TitleType } from "./types";

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

/** Тип интерфейса для категории из БД; неизвестная (новая на сервере) считается сериалом, чтобы запись осталась видимой */
export const typeFromApi = (category: string): TitleType => (CATEGORY_FROM_API as Record<string, TitleType | undefined>)[category] ?? "series";

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
  const type = typeFromApi(a.category);
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
  rating?: number | null;
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
    type: typeFromApi(a.category),
    t: a.title,
    en: a.original_title ?? undefined,
    y: a.year ?? 0,
    g: a.genres.map(capitalize),
    c: a.country ?? "—",
    author: a.author ?? undefined,
    img: a.poster_url ?? undefined,
    rating: a.rating ?? undefined,
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

// ---------- Ручное обогащение ----------

export interface ApiEnrichCandidate {
  source: string;
  external_id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_url: string | null;
  genres: string[];
  country: string | null;
  author: string | null;
}

export interface ApiEnrichApply {
  item: ApiItem;
  /** поля БД, которые были заполнены (poster_url, genres, country, release_year, author) */
  changed: string[];
}

export function toEnrichCandidate(a: ApiEnrichCandidate): EnrichCandidate {
  return {
    key: `${a.source}:${a.external_id}`,
    source: a.source,
    extId: a.external_id,
    t: a.title,
    en: a.original_title ?? undefined,
    y: a.year ?? 0,
    g: a.genres.map(capitalize),
    c: a.country ?? "—",
    author: a.author ?? undefined,
    img: a.poster_url ?? undefined,
  };
}

// ---------- Статистика ----------

export interface ApiStats {
  period_from: string;
  period_to: string;
  total_items: number;
  genres: StatsRow[];
  countries: StatsRow[];
  categories: StatsRow[];
  statuses: StatsRow[];
  years: { year: number; items: number; progress: number }[];
  top_items: { item_id: number; title_ru: string; title_original: string | null; category: ApiCategory; progress: number }[];
  totals: StatsMarks;
  activity: { date: string; count: number }[];
  marks: StatsMarks;
}

export function toStats(a: ApiStats): Stats {
  return {
    from: a.period_from,
    to: a.period_to,
    totalItems: a.total_items,
    genres: a.genres.map((g) => ({ ...g, name: capitalize(g.name) })),
    countries: a.countries,
    years: a.years,
    top: a.top_items.map((t) => ({ id: t.item_id, title: t.title_ru, en: t.title_original ?? undefined, type: typeFromApi(t.category), progress: t.progress })),
    totals: a.totals,
    activity: a.activity,
    marks: a.marks,
  };
}

// ---------- Экспорт ----------

export type ExportFormat = "xlsx" | "json";

/** Имя файла из заголовка Content-Disposition; без пути и опасных символов. null, если заголовка нет или имя пустое */
export function filenameFrom(header: string | null): string | null {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? "");
  let raw = match?.[1] ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* имя не закодировано: берём как есть */
  }
  const name = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/^\.+/, "").trim();
  return name || null;
}

/**
 * Файл экспорта, собранный сервером (GET /export): Excel или JSON с библиотекой и журналом.
 * Возвращает содержимое и имя файла; ошибки сервера приходят как ApiError.
 */
export async function downloadExport(format: ExportFormat): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/export?format=${format}`, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw new ApiError(0, e instanceof Error && e.name === "TimeoutError" ? "Сервер не ответил вовремя" : "Нет связи с сервером");
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(await res.json().catch(() => null), res.status));
  const today = new Date().toISOString().slice(0, 10);
  return { blob: await res.blob(), filename: filenameFrom(res.headers.get("content-disposition")) ?? `episodio-${today}.${format}` };
}

/**
 * Серверный JSON-экспорт (записи в формате API: title_ru, genres…) превращается в формат копии интерфейса, который
 * понимает восстановление. Копии в формате интерфейса и всё нераспознанное возвращаются без изменений.
 */
export function fromServerExport(data: unknown): unknown {
  const obj = data as { items?: unknown } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.items)) return data;
  const first = obj.items[0] as { title_ru?: unknown } | undefined;
  if (!first || typeof first.title_ru !== "string") return data;
  return { items: (obj.items as ApiItem[]).map(toTitle) };
}

// ---------- Витрины ----------

export interface ApiShowcase {
  id: number;
  slug: string;
  title: string;
  category: ApiCategory | null;
  year: number | null;
  month: number | null;
  max_items: number;
  is_public: boolean;
  created_at: string;
}

export interface ApiShowcaseItem {
  title_ru: string;
  title_original: string | null;
  category: ApiCategory;
  release_year: number | null;
  genres: string[];
  country: string | null;
  author: string | null;
  rating: number;
  poster: string | null;
  finished_on: string | null;
}

export interface ApiShowcaseView {
  title: string;
  category: ApiCategory | null;
  year: number | null;
  month: number | null;
  items: ApiShowcaseItem[];
}

export function toShowcase(a: ApiShowcase): Showcase {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    type: a.category ? typeFromApi(a.category) : "all",
    year: a.year,
    month: a.month,
    max: a.max_items,
    isPublic: a.is_public,
  };
}

/** Тело запроса витрины: "all" уходит как category = null */
export function toApiShowcaseFilter(d: ShowcaseDraft) {
  return { title: d.title.trim(), category: d.type === "all" ? null : CATEGORY_TO_API[d.type], year: d.year, month: d.year ? d.month : null, max_items: d.max };
}

/** poster превращает адрес постера из ответа в адрес для браузера: у предпросмотра это прокси, у публичной страницы — её собственный маршрут */
export function toShowcaseView(a: ApiShowcaseView, poster: (src: string | null) => string | undefined = posterSrc): ShowcaseView {
  return {
    title: a.title,
    type: a.category ? typeFromApi(a.category) : "all",
    year: a.year,
    month: a.month,
    cards: a.items.map((i) => ({
      t: i.title_ru,
      en: i.title_original ?? undefined,
      type: typeFromApi(i.category),
      y: i.release_year ?? 0,
      g: i.genres.map(capitalize),
      c: i.country ?? "—",
      author: i.author ?? undefined,
      rate: i.rating,
      img: poster(i.poster),
      finished: i.finished_on ?? undefined,
    })),
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

// ---------- Эпи: диалоги ----------

export interface AiConversation {
  id: number;
  title: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

interface ApiAiConversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ApiAiMessage {
  id: number;
  role: string;
  content: string;
}

export const toAiConversation = (a: ApiAiConversation): AiConversation => ({ id: a.id, title: a.title, updatedAt: a.updated_at });

/** Только реплики людей и ответы ассистента: служебные роли (system, tool) в чате не показываем */
export const toAiMessages = (list: ApiAiMessage[]): AiMessage[] =>
  list.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ id: m.id, role: m.role as AiMessage["role"], content: m.content }));

/** Обработчики потока ответа: onChunk — кусок текста, onTool — Эпи вызвала инструмент (имя) */
export interface AiStreamHandlers {
  onChunk: (text: string) => void;
  onTool?: (name: string) => void;
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

/** Сколько ждём ответ: обычный запрос и загрузка файла */
const TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** Поиск вариантов и применение идут во внешние API (с паузами между запросами), поэтому ждём дольше */
const ENRICH_TIMEOUT_MS = 45_000;

/** Записей за один запрос при загрузке библиотеки (максимум бэкенда — 500) */
export const ITEMS_PAGE = 200;

async function call<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new ApiError(0, "Сервер не ответил вовремя");
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status));
  return body as T;
}

/** Поток ответа Эпи: POST с телом {content}, в ответ SSE (см. backend/ai); конец потока — [DONE] или закрытие соединения */
async function streamAiMessage(path: string, content: string, handlers: AiStreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...json("POST", { content }), signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (!res.ok || !res.body) {
    const body: unknown = await res.json().catch(() => null);
    throw new ApiError(res.status, errorMessage(body, res.status));
  }

  let failure: string | null = null;
  const feed = createSseParser((data) => {
    const event: AiStreamEvent | "done" | null = parseAiEvent(data);
    if (event === null || event === "done") return;
    if ("chunk" in event) handlers.onChunk(event.chunk);
    else if ("tool" in event) handlers.onTool?.(event.tool);
    else failure = event.error;
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError(0, "Соединение прервано");
  }
  if (failure) throw new ApiError(502, failure);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  /** Вся библиотека, свежеобновлённые первыми: читается страницами, пока не придёт неполная */
  listItems: async (): Promise<Title[]> => {
    const all: ApiItem[] = [];
    for (let offset = 0; ; offset += ITEMS_PAGE) {
      const page = await call<ApiItem[]>(`/items/?limit=${ITEMS_PAGE}&offset=${offset}`);
      all.push(...page);
      if (page.length < ITEMS_PAGE) break;
    }
    return all.map(toTitle);
  },
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

  /** Статистика: распределения по библиотеке и отметки журнала за период (даты YYYY-MM-DD включительно) */
  getStats: async (opts: { from?: string; to?: string; limit?: number } = {}): Promise<Stats> => {
    const q = new URLSearchParams();
    if (opts.from) q.set("from", opts.from);
    if (opts.to) q.set("to", opts.to);
    if (opts.limit) q.set("limit", String(opts.limit));
    return toStats(await call<ApiStats>(`/stats${q.size ? `?${q}` : ""}`));
  },

  listShowcases: async (): Promise<Showcase[]> => (await call<ApiShowcase[]>("/showcases")).map(toShowcase),
  createShowcase: async (d: ShowcaseDraft, extra: { slug?: string; isPublic?: boolean } = {}): Promise<Showcase> =>
    toShowcase(await call<ApiShowcase>("/showcases", json("POST", { ...toApiShowcaseFilter(d), slug: extra.slug, is_public: extra.isPublic ?? false }))),
  /** Частичное изменение: передаются только перечисленные поля */
  updateShowcase: async (id: number, patch: Partial<ShowcaseDraft> & { slug?: string; isPublic?: boolean }): Promise<Showcase> => {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title.trim();
    if (patch.type !== undefined) body.category = patch.type === "all" ? null : CATEGORY_TO_API[patch.type];
    if (patch.year !== undefined) body.year = patch.year;
    if (patch.month !== undefined) body.month = patch.month;
    if (patch.max !== undefined) body.max_items = patch.max;
    if (patch.slug !== undefined) body.slug = patch.slug;
    if (patch.isPublic !== undefined) body.is_public = patch.isPublic;
    return toShowcase(await call<ApiShowcase>(`/showcases/${id}`, json("PATCH", body)));
  },
  deleteShowcase: (id: number) => call<void>(`/showcases/${id}`, { method: "DELETE" }),
  /** Предпросмотр по параметрам, ничего не сохраняя */
  previewShowcase: async (d: ShowcaseDraft): Promise<ShowcaseView> =>
    toShowcaseView(await call<ApiShowcaseView>("/showcases/preview", json("POST", toApiShowcaseFilter(d)))),

  listConversations: async (): Promise<AiConversation[]> => (await call<ApiAiConversation[]>("/ai/conversations")).map(toAiConversation),
  createConversation: async (title?: string): Promise<AiConversation> =>
    toAiConversation(await call<ApiAiConversation>("/ai/conversations", json("POST", title ? { title } : {}))),
  /** Последние 30 реплик диалога по порядку */
  listAiMessages: async (conversationId: number): Promise<AiMessage[]> => toAiMessages(await call<ApiAiMessage[]>(`/ai/conversations/${conversationId}/messages`)),
  /**
   * Отправляет реплику и читает ответ Эпи потоком SSE: куски текста приходят в onChunk по мере генерации.
   * Ошибка модели посреди потока — ApiError(502); signal прерывает чтение (запрос к FastAPI тоже обрывается).
   */
  streamAiMessage: (conversationId: number, content: string, handlers: AiStreamHandlers, signal?: AbortSignal) =>
    streamAiMessage(`/ai/conversations/${conversationId}/messages`, content, handlers, signal),

  /** Жанры из БД для фильтра (с заглавной буквы) */
  listGenres: async (): Promise<string[]> => (await call<string[]>("/genres")).map(capitalize),

  /** Живой поиск по внешним каталогам; без type ищет по основным категориям. errors — недоступные источники */
  searchCatalog: async (q: string, type?: TitleType, limit?: number, source?: string): Promise<{ results: CatalogResult[]; errors: string[] }> => {
    const params = new URLSearchParams({ q });
    if (type) params.set("category", CATEGORY_TO_API[type]);
    if (source) params.set("source", source);
    if (limit) params.set("limit", String(limit));
    const r = await call<ApiCatalogSearch>(`/catalog/search?${params}`);
    return { results: r.results.map(toCatalogResult), errors: r.errors };
  },
  /** Популярное для полок «Обзора»; без type — по основным категориям. errors — недоступные источники */
  popularCatalog: async (type?: TitleType, limit?: number, source?: string): Promise<{ results: CatalogResult[]; errors: string[] }> => {
    const params = new URLSearchParams();
    if (type) params.set("category", CATEGORY_TO_API[type]);
    if (source) params.set("source", source);
    if (limit) params.set("limit", String(limit));
    const r = await call<ApiCatalogSearch>(`/catalog/popular${params.size ? `?${params}` : ""}`, undefined, ENRICH_TIMEOUT_MS);
    return { results: r.results.map(toCatalogResult), errors: r.errors };
  },
  /** Добавляет найденный тайтл в библиотеку (сервер сам скачает постер); дубликат — ApiError 409 */
  addFromCatalog: async (r: CatalogResult, st: TitleStatus): Promise<Title> =>
    toTitle(await call<ApiItem>("/items/from-catalog", json("POST", toApiCatalogAdd(r, st)))),

  /** Варианты из внешнего источника для карточки; ничего не сохраняет */
  listCandidates: async (id: number, source?: string): Promise<EnrichCandidate[]> =>
    (await call<ApiEnrichCandidate[]>(`/items/${id}/enrich/candidates${source ? `?source=${encodeURIComponent(source)}` : ""}`, undefined, ENRICH_TIMEOUT_MS)).map(toEnrichCandidate),
  /** Применяет вариант: заполняются пустые поля; force заменяет ещё и постер. changed — заполненные поля БД */
  applyCandidate: async (id: number, source: string, externalId: string, force = false): Promise<{ item: Title; changed: string[] }> => {
    const r = await call<ApiEnrichApply>(
      `/items/${id}/enrich/apply${force ? "?force=true" : ""}`,
      json("POST", { source, external_id: externalId }),
      ENRICH_TIMEOUT_MS,
    );
    return { item: toTitle(r.item), changed: r.changed };
  },

  uploadPoster: async (id: number, file: File): Promise<Title> => {
    const form = new FormData();
    form.append("file", file);
    return toTitle(await call<ApiItem>(`/items/${id}/poster`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS));
  },
  deletePoster: async (id: number): Promise<Title> => toTitle(await call<ApiItem>(`/items/${id}/poster`, { method: "DELETE" })),
};
