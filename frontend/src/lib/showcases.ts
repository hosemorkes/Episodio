/** Витрины: чистые функции редактора (названия, периоды, ссылки). Данные приходят с сервера через api.ts */
import type { Showcase, ShowcaseDraft, ShowcaseView, TitleType } from "./types";

type Tr = (ru: string) => string;

export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** Сколько мест в топе можно выбрать */
export const SHOWCASE_SIZES = [4, 8, 12, 20];

/** Родительный падеж множественного числа для «Мой топ …» */
export const GENITIVE: Record<TitleType | "all", string> = {
  all: "",
  anime: "аниме",
  cartoon: "мультсериалов",
  series: "сериалов",
  movie: "фильмов",
  show: "ТВ-шоу",
  manga: "манги",
  book: "книг",
  audiobook: "аудиокниг",
};

/** Годы для выбора: от текущего назад на шесть лет */
export function showcaseYears(now = new Date()): number[] {
  return Array.from({ length: 7 }, (_, i) => now.getFullYear() - i);
}

/** «2026, март», «2026» или «за всё время» */
export function periodLabel(year: number | null, month: number | null, t: Tr): string {
  if (!year) return t("за всё время");
  return month ? `${year}, ${t(MONTHS_FULL[month - 1])}` : String(year);
}

/** Название по умолчанию: «Мой топ аниме 2026, март», «Мой топ за всё время» */
export function defaultTitle(d: Pick<ShowcaseDraft, "type" | "year" | "month">, t: Tr): string {
  const what = d.type === "all" ? "" : ` ${t(GENITIVE[d.type])}`;
  const when = d.year ? ` ${periodLabel(d.year, d.month, t)}` : ` ${periodLabel(null, null, t)}`;
  return `${t("Мой топ")}${what}${when}`;
}

export const draftOf = (s: Showcase): ShowcaseDraft => ({ title: s.title, type: s.type, year: s.year, month: s.month, max: s.max });

/** Совпадают ли параметры (название сравнивается без лишних пробелов) */
export function sameDraft(a: ShowcaseDraft, b: ShowcaseDraft): boolean {
  return a.title.trim() === b.title.trim() && a.type === b.type && a.year === b.year && (a.year ? a.month : null) === (b.year ? b.month : null) && a.max === b.max;
}

/** Путь публичной страницы витрины */
export const sharePath = (handle: string, slug: string) => `/u/${handle}/${slug}`;

/** Короткое описание для превью ссылки: «Топ из 3: 1. Фрирен (10), 2. …» */
export function describeView(view: ShowcaseView, t: Tr, lang: "ru" | "en" = "ru"): string {
  if (!view.cards.length) return t("Пока здесь пусто");
  const list = view.cards
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${lang === "en" && c.en ? c.en : c.t} (${c.rate})`)
    .join(", ");
  return `${t("Топ из ")}${view.cards.length}: ${list}`;
}
