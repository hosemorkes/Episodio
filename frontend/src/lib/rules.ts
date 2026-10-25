import type { AirStatus, CatalogItem, Title, TitleStatus, TitleType } from "./types";

/** Функция перевода: ключ — русская строка */
export type Tr = (ru: string) => string;

export const TYPES: [TitleType, string][] = [
  ["anime", "Аниме"],
  ["cartoon", "Мультсериал"],
  ["series", "Сериал"],
  ["movie", "Фильм"],
  ["show", "ТВ-шоу"],
  ["manga", "Манга"],
  ["book", "Книга"],
  ["audiobook", "Аудиокнига"],
];

/** Названия категорий во множественном числе (вкладки каталога) */
export const TYPES_PLURAL: Record<TitleType, string> = {
  anime: "Аниме",
  cartoon: "Мультсериалы",
  series: "Сериалы",
  movie: "Фильмы",
  show: "ТВ-шоу",
  manga: "Манга",
  book: "Книги",
  audiobook: "Аудиокниги",
};

export const ALL_GENRES = ["Экшен", "Драма", "Комедия", "Фэнтези", "Детектив", "Романтика", "Фантастика", "Триллер"];

export const AIR_LABEL: Record<AirStatus, string> = { o: "Выходит", d: "Завершён", s: "Анонс" };

/** Прогресс по главам (и том): манга, книги, аудиокниги */
export const isReading = (type: TitleType) => type === "book" || type === "manga" || type === "audiobook";
/** Прогресс по сериям и сезонам */
export const hasSeasons = (type: TitleType) => type === "anime" || type === "series" || type === "cartoon" || type === "show";

export const typeName = (type: TitleType, t: Tr) => t(TYPES.find(([k]) => k === type)?.[1] ?? "Аниме");

/** Статус карточки по прогрессу: последняя серия → «просмотрено», начатое → «смотрю» */
export function fixSt(st: TitleStatus, ep: number, tot: number): TitleStatus {
  // tot = 0 — общее число неизвестно (идущий сериал), по прогрессу «просмотрено» не определить
  if (tot > 0 && ep >= tot) return "done";
  if (st === "done" || (st === "planned" && ep > 0)) return "watching";
  return st;
}

/** Подписи единиц прогресса (серии / главы / фильм) */
export function unitOf(type: TitleType, t: Tr) {
  if (type === "movie")
    return { u: "film" as const, mark: t("Отметить просмотр"), line: t("Фильм"), left: t("Не просмотрен"), done: t("Фильм просмотрен"), w: t("Просмотрено"), t: t("Всего"), short: "", toast: t(" · просмотрен") };
  if (type === "audiobook")
    return { u: "ch" as const, mark: t("Отметить главу "), line: t("Глава "), left: t("Осталось глав: "), done: t("Все главы прослушаны"), w: t("Прослушано глав"), t: t("Всего глав"), short: t(" гл."), toast: t(" · глава ") };
  if (isReading(type))
    return { u: "ch" as const, mark: t("Отметить главу "), line: t("Глава "), left: t("Осталось глав: "), done: t("Все главы прочитаны"), w: t("Прочитано глав"), t: t("Всего глав"), short: t(" гл."), toast: t(" · глава ") };
  return { u: "ep" as const, mark: t("Отметить серию "), line: t("Серия "), left: t("Осталось серий: "), done: t("Все серии просмотрены"), w: t("Просмотрено серий"), t: t("Всего серий"), short: t(" сер."), toast: t(" · серия ") };
}

/** «5 / 12», а если общее число неизвестно (tot = 0, идущий сериал) — просто «5» */
export const progressText = (ep: number, tot: number) => (tot > 0 ? `${ep} / ${tot}` : String(ep));

export function metaOf(it: Title, t: Tr): string {
  if (it.type === "movie") return `${it.y} · ${t(it.ep >= it.tot ? "Фильм просмотрен" : "Не просмотрен")}`;
  if (isReading(it.type)) return `${it.vol ? `${t("Т")}${it.vol} · ` : ""}${progressText(it.ep, it.tot)}${t(" гл.")} · ${it.y}`;
  return `${t("С")}${it.se ?? 1} · ${progressText(it.ep, it.tot)} · ${it.y}`;
}

export function statusLabel(k: TitleStatus, type: TitleType, t: Tr, fallback: string) {
  if (type === "audiobook") {
    if (k === "watching") return t("Слушаю");
    if (k === "done") return t("Прослушано");
    return fallback;
  }
  const rd = isReading(type);
  if (k === "watching") return t(rd ? "Читаю" : "Смотрю");
  if (k === "done") return t(rd ? "Прочитано" : "Просмотрено");
  return fallback;
}

export const STATUSES: [TitleStatus, string][] = [
  ["watching", "В процессе"],
  ["planned", "В планах"],
  ["done", "Завершено"],
  ["dropped", "Брошено"],
];

/** Изменения при ручной смене статуса: «просмотрено» ставит ep=tot, «в планах» — ep=0 */
export function statusPatch(x: Title, st: TitleStatus): Title {
  const known = x.tot > 0;
  const ep = st === "done" ? (known ? x.tot : x.ep) : st === "planned" ? 0 : st === "watching" && known && x.ep >= x.tot ? Math.max(0, x.tot - 1) : x.ep;
  return { ...x, st, ep };
}

export function posterBg(img: string | undefined, h: [number, number]) {
  if (img) return `url("${img}") center/cover`;
  return `linear-gradient(160deg,hsl(${h[0]},55%,38%),hsl(${h[1]},60%,22%))`;
}

export const catalogBg = (h: number) => posterBg(undefined, [h, (h + 40) % 360]);

export const initials = (s: string, n = 2) =>
  s.split(/[\s:]+/).filter(Boolean).map((x) => x[0]).join("").slice(0, n).toUpperCase();

export const displayName = (it: { t: string; en?: string }, lang: "ru" | "en") => (lang === "en" && it.en ? it.en : it.t);
export const altName = (it: { t: string; en?: string }, lang: "ru" | "en") => (lang === "en" ? (it.en ? it.t : "") : it.en || "");

/** Позиция в библиотеке для записи каталога (совпадение по названию и типу) */
export const findMine = (items: Title[], c: { t: string; type: TitleType }) => items.find((x) => x.t === c.t && x.type === c.type);

export const genreLine = (g: string[], t: Tr) => g.map(t).join(", ");

/** Процент выполнения; при неизвестном общем числе (b = 0) шкала пустая */
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function genreCounts(items: Title[]) {
  const uc: Record<string, number> = {};
  items.forEach((x) => x.g.forEach((g) => (uc[g] = (uc[g] || 0) + 1)));
  return uc;
}

/** Рекомендации: каталог, которого нет в библиотеке, по совпадению жанров и рейтингу */
export function recommend(items: Title[], catalog: CatalogItem[], limit: number, onlyRated = false) {
  const uc = genreCounts(items);
  return catalog
    .filter((c) => !findMine(items, c) && (!onlyRated || c.r))
    .map((c) => ({ c, sc: c.g.reduce((a, g) => a + (uc[g] || 0), 0) + c.r / 10 }))
    .sort((a, b) => b.sc - a.sc)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Суммы просмотренного по ключу (жанр, страна) — для статистики */
export function tally(items: Title[], keys: (it: Title) => string[]) {
  const m: Record<string, number> = {};
  items.forEach((it) => keys(it).forEach((k) => (m[k] = (m[k] || 0) + it.ep)));
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

export const YEAR_BUCKETS = ["≤2009", "2010–14", "2015–19", "2020–22", "2023+"];
export const yearBucket = (y: number) => (y <= 2009 ? 0 : y <= 2014 ? 1 : y <= 2019 ? 2 : y <= 2022 ? 3 : 4);

export function exportRows(items: Title[], t: Tr) {
  const ST = Object.fromEntries(STATUSES);
  const head = ["Название", "Название (English)", "Тип", "Статус", "Год", "Страна", "Жанры", "Сезон", "Том", "Прогресс", "Оценка", "Автор", "Озвучка", "Ссылка", "Описание", "Заметка"].map(t);
  const body = items.map((x) => [
    x.t,
    x.en ?? "",
    typeName(x.type, t),
    t(ST[x.st] ?? ST.planned),
    x.y,
    t(x.c),
    x.g.map(t).join(", "),
    hasSeasons(x.type) ? (x.se ?? 1) : "",
    isReading(x.type) ? (x.vol ?? "") : "",
    progressText(x.ep, x.tot),
    x.rate || "",
    x.author ?? "",
    x.tr ?? "",
    x.link ?? "",
    x.desc ?? "",
    x.note ?? "",
  ]);
  return { head, body };
}

/** Проверка файла резервной копии: массив тайтлов или объект с items */
export function parseBackup(d: unknown): { items: Title[]; log?: unknown[] } | null {
  const obj = d as { items?: unknown; log?: unknown } | null;
  const items = Array.isArray(d) ? d : obj && typeof obj === "object" ? obj.items : null;
  if (!Array.isArray(items)) return null;
  const ok = items.every(
    (x) => x && typeof x === "object" && typeof x.t === "string" && Array.isArray(x.g) && typeof x.ep === "number" && typeof x.tot === "number",
  );
  if (!ok) return null;
  // Копии старого формата: первый отзыв (rv) становится заметкой, страницы книг (pg, pgTot) отбрасываются
  const withDefaults = items.map((x, i) => {
    const { rv, pg: _pg, pgTot: _pgTot, ...rest } = x as Record<string, unknown> & { rv?: { t?: unknown }[] };
    const legacyNote = Array.isArray(rv) && typeof rv[0]?.t === "string" ? rv[0].t : undefined;
    const note = typeof rest.note === "string" && rest.note ? rest.note : legacyNote;
    return { id: i + 1, type: "anime", st: "planned", y: 0, c: "—", h: [210, 230], ...rest, ...(note ? { note } : {}) } as Title;
  });
  return { items: withDefaults, log: !Array.isArray(d) && obj && Array.isArray(obj.log) ? obj.log : undefined };
}
