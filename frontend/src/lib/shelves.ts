/** Полки «Обзора» из живой подборки (GET /catalog/popular): фильтры, сортировка, группы и рекомендации */
import { findMine, genreCounts } from "./rules";
import type { CatalogResult, Title } from "./types";

export type YearFilter = "all" | "2020" | "2010" | "2000" | "old";
export type Sort = "pop" | "rating" | "new";

export const YEAR_OK: Record<YearFilter, (y: number) => boolean> = {
  all: () => true,
  "2020": (y) => y >= 2020,
  "2010": (y) => y >= 2010 && y < 2020,
  "2000": (y) => y >= 2000 && y < 2010,
  old: (y) => y < 2000,
};

/** Сколько карточек в полке */
export const SHELF_SIZE = 12;

export interface Shelf {
  key: string;
  title: string;
  sub: string;
  cards: CatalogResult[];
}

type Tr = (ru: string) => string;

/**
 * Фильтры по жанру (все выбранные сразу) и году. Результат без года (y = 0) под фильтр по году не попадает,
 * без выбранных фильтров список возвращается как есть.
 */
export function filterLive(results: CatalogResult[], genres: string[], year: YearFilter): CatalogResult[] {
  return results.filter((r) => genres.every((g) => r.g.includes(g)) && (year === "all" || (r.y > 0 && YEAR_OK[year](r.y))));
}

/** «По популярности» сохраняет порядок сервера, «По рейтингу» ставит записи без оценки в конец, «Новинки» — по году */
export function sortLive(results: CatalogResult[], sort: Sort): CatalogResult[] {
  const list = [...results];
  if (sort === "rating") return list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (sort === "new") return list.sort((a, b) => b.y - a.y);
  return list;
}

/** Чередует категории (аниме, сериал, фильм…), сохраняя порядок внутри каждой: на вкладке «Все» наверху полки не одна категория */
export function interleave(results: CatalogResult[]): CatalogResult[] {
  const groups = new Map<string, CatalogResult[]>();
  results.forEach((r) => groups.set(r.type, [...(groups.get(r.type) ?? []), r]));
  const lists = [...groups.values()];
  const out: CatalogResult[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

/** Самые частые жанры среди результатов (для фильтра): внешние источники называют жанры по-своему, поэтому берём их из ответа */
export function topGenres(results: CatalogResult[], limit = 12): string[] {
  const counts: Record<string, number> = {};
  results.forEach((r) => r.g.forEach((g) => (counts[g] = (counts[g] ?? 0) + 1)));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([g]) => g);
}

/** Рекомендации: то, чего нет в библиотеке, по совпадению жанров с тем, что у вас уже есть, плюс оценка источника */
export function recommendLive(items: Title[], results: CatalogResult[], limit: number): CatalogResult[] {
  const uc = genreCounts(items);
  return results
    .filter((r) => !findMine(items, r))
    .map((r) => ({ r, score: r.g.reduce((a, g) => a + (uc[g] || 0), 0) + (r.rating ?? 0) / 10 }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * Полки «Обзора»: популярное, до двух лучших по оценке жанров и рекомендации по библиотеке.
 * Полка жанра появляется, когда в нём не меньше трёх оценённых тайтлов; пустые полки не возвращаются.
 */
export function buildShelves(results: CatalogResult[], items: Title[], t: Tr): Shelf[] {
  const shelves: Shelf[] = [
    { key: "pop", title: t("Популярное сейчас"), sub: t("Что смотрят и читают прямо сейчас"), cards: interleave(results).slice(0, SHELF_SIZE) },
  ];

  const rated = results.filter((r) => r.rating);
  const genreShelves = topGenres(rated, 8)
    .map((g) => ({ g, cards: sortLive(rated.filter((r) => r.g.includes(g)), "rating").slice(0, SHELF_SIZE) }))
    .filter((x) => x.cards.length >= 3)
    .slice(0, 2);
  genreShelves.forEach(({ g, cards }) => shelves.push({ key: `g-${g}`, title: t("Топ в жанре ") + t(g), sub: t("Лучшие по оценке"), cards }));

  const rec = recommendLive(items, results, 10);
  if (rec.length) {
    const top = Object.entries(genreCounts(items))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((x) => t(x[0]))
      .join(", ");
    shelves.push({ key: "ai", title: t("AI рекомендует вам"), sub: top ? t("На основе ваших тайтлов: ") + top : "", cards: rec });
  }
  return shelves.filter((s) => s.cards.length);
}
