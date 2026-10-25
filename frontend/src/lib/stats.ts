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

/** В библиотеке нет ни одной записи: считать нечего (диаграммы строятся по числу тайтлов, прогресс не нужен) */
export const isStatsEmpty = (s: Stats) => s.totalItems === 0;
