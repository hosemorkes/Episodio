/** Логика ручного обогащения: чего не хватает карточке, подписи источников и полей, разбор ошибок */
import { ApiError } from "./api";
import type { Title } from "./types";

type Tr = (ru: string) => string;

export type Gap = "poster" | "genres" | "country" | "year";

/** Что обогащение умеет заполнить; порядок — как показываем в списке */
export const GAP_LABELS: Record<Gap, string> = {
  poster: "Нет постера",
  genres: "Нет жанров",
  country: "Нет страны",
  year: "Нет года",
};

/** Чего не хватает карточке: пустые поля, которые подставит внешний источник */
export function gapsOf(it: Title): Gap[] {
  const gaps: Gap[] = [];
  if (!it.img) gaps.push("poster");
  if (!it.g.length) gaps.push("genres");
  if (!it.c || it.c === "—") gaps.push("country");
  if (!it.y) gaps.push("year");
  return gaps;
}

export const needsReview = (it: Title) => gapsOf(it).length > 0;

const SOURCE_NAMES: Record<string, string> = { tmdb: "TMDB", shikimori: "Shikimori", openlibrary: "Open Library" };
export const sourceName = (source: string) => SOURCE_NAMES[source] ?? source;

/** Поля БД из ответа apply -> названия для тоста */
const FIELD_LABELS: Record<string, string> = {
  poster_url: "постер",
  genres: "жанры",
  country: "страна",
  release_year: "год",
  author: "автор",
};

/** «Заполнено: постер, жанры» или «Новых данных нет», если источник ничего не добавил */
export function changedText(changed: string[], t: Tr): string {
  const names = changed.map((f) => t(FIELD_LABELS[f] ?? f));
  return names.length ? t("Заполнено: ") + names.join(", ") : t("Новых данных нет: всё уже заполнено");
}

/**
 * Сообщение об ошибке обогащения и что делать дальше.
 * Текст берётся из ответа сервера (400/404/502/503 приходят с понятным detail).
 * retry: повторить имеет смысл при обрыве связи и 502/504 (внешний сервис недоступен) и при 404 (вариант пропал из выдачи).
 * reload: при 404 повторять выбор бесполезно, нужно обновить список вариантов.
 * 400 (категория не поддерживается) и 503 (ключ не настроен) повтором не лечатся.
 */
export function enrichErrorInfo(e: unknown): { message: string; retry: boolean; reload: boolean } {
  if (e instanceof ApiError) {
    const reload = e.status === 404;
    return { message: e.message, retry: reload || e.status === 0 || e.status === 502 || e.status === 504, reload };
  }
  return { message: "Не удалось выполнить действие", retry: true, reload: false };
}
