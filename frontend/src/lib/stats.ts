/** Чистые функции статистики: недели, отметки по дням, суммы серий и глав */
import { isReading, YEAR_BUCKETS, yearBucket } from "./rules";
import type { Stats, StatsMarks, Title } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Локальная дата в формате YYYY-MM-DD (не через UTC: иначе ночью день сдвигается) */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Неделя с понедельника по воскресенье, в которую попадает now; todayIdx — позиция сегодняшнего дня (Пн = 0) */
export function weekRange(now: Date): { from: string; to: string; todayIdx: number } {
  const todayIdx = (now.getDay() + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun), todayIdx };
}

/** Отметки по дням недели Пн..Вс. Дни, которых нет в ответе, считаются нулём */
export function weekCounts(activity: Stats["activity"], from: string): number[] {
  const [y, m, d] = from.split("-").map(Number);
  const keys = Array.from({ length: 7 }, (_, i) => ymd(new Date(y, m - 1, d + i)));
  const byDate = new Map(activity.map((a) => [a.date, a.count]));
  return keys.map((k) => byDate.get(k) ?? 0);
}

/**
 * Накоплено по библиотеке: серии, главы и просмотренные фильмы отдельно.
 * Те же правила, что у `totals` в GET /stats; считаем по копии библиотеки в сторе, чтобы счётчик на главной
 * менялся сразу после «+», не дожидаясь ответа сервера.
 */
export function totalsOf(items: Title[]): StatsMarks {
  const t: StatsMarks = { episodes: 0, chapters: 0, movies: 0 };
  for (const it of items) {
    if (it.type === "movie") t.movies += it.st === "done" ? 1 : 0;
    else if (isReading(it.type)) t.chapters += it.ep;
    else t.episodes += it.ep;
  }
  return t;
}

/** Приблизительные часы просмотра: серия ≈ 24 минуты (главы и фильмы в часы не переводятся) */
export const watchHours = (episodes: number) => Math.round((episodes * 24) / 60);

/** Число тайтлов по периодам года выхода (столбцы «Годы выхода», подписи — YEAR_BUCKETS) */
export function yearBars(years: Stats["years"]): number[] {
  const bars = YEAR_BUCKETS.map(() => 0);
  years.forEach((y) => (bars[yearBucket(y.year)] += y.items));
  return bars;
}

const NO_GENRE = new Set(["Без жанра", "No genre"]);

/** Строки «название → число тайтлов» по убыванию, при равенстве по алфавиту */
function countRows(names: string[]): [string, number][] {
  const m = new Map<string, number>();
  names.forEach((n) => m.set(n, (m.get(n) ?? 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Разрезы статистики по копии библиотеки в сторе, с необязательным фильтром по типу.
 * Жанры, страны и годы считаются по числу тайтлов (каждая карточка = 1); топ — по накопленному прогрессу
 * (серии или главы, просмотренный фильм = 1). Считать на клиенте можно потому, что библиотека загружена целиком:
 * так сразу видны новые жанры и работает выбор раздела.
 */
export function libraryBreakdown(items: Title[], type: "all" | Title["type"], topLimit = 5) {
  const list = type === "all" ? items : items.filter((x) => x.type === type);
  const progress = (x: Title) => (x.type === "movie" ? (x.st === "done" ? 1 : 0) : x.ep);
  const bars = YEAR_BUCKETS.map(() => 0);
  list.forEach((x) => x.y > 0 && (bars[yearBucket(x.y)] += 1));
  return {
    total: list.length,
    genres: countRows(list.flatMap((x) => x.g.filter((g) => !NO_GENRE.has(g)))),
    countries: countRows(list.map((x) => x.c).filter((c) => c && c !== "—")),
    years: bars,
    top: list
      .map((x) => ({ item: x, progress: progress(x) }))
      .filter((x) => x.progress > 0)
      .sort((a, b) => b.progress - a.progress || a.item.t.localeCompare(b.item.t))
      .slice(0, topLimit),
  };
}

/** Распределение оценок: counts[0] — тайтлы с оценкой 1, counts[9] — с оценкой 10; без оценки считаются отдельно */
export function ratingBreakdown(items: Title[], type: "all" | Title["type"]) {
  const list = type === "all" ? items : items.filter((x) => x.type === type);
  const counts = Array<number>(10).fill(0);
  let sum = 0;
  let rated = 0;
  for (const x of list) {
    const r = x.rate ?? 0;
    if (r >= 1 && r <= 10) {
      counts[r - 1] += 1;
      sum += r;
      rated += 1;
    }
  }
  return { counts, rated, unrated: list.length - rated, avg: rated ? Math.round((sum / rated) * 10) / 10 : 0 };
}

/** В библиотеке нет ни одной записи: считать нечего (диаграммы строятся по числу тайтлов, прогресс не нужен) */
export const isStatsEmpty = (s: Stats) => s.totalItems === 0;
