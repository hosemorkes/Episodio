/** Все 8 категорий бэкенда; `series` ↔ `tv_series`, `show` ↔ `tv_show` (см. src/lib/api.ts) */
export type TitleType = "anime" | "cartoon" | "series" | "movie" | "show" | "manga" | "book" | "audiobook";
export type TitleStatus = "watching" | "planned" | "done" | "dropped";
export type Lang = "ru" | "en";
export type Theme = "dark" | "light";

/** Карточка в библиотеке пользователя */
export interface Title {
  id: number;
  type: TitleType;
  st: TitleStatus;
  /** название */
  t: string;
  /** оригинальное название */
  en?: string;
  desc?: string;
  /** постер: dataURL или путь; пусто — градиентная заглушка */
  img?: string;
  /** год */
  y: number;
  /** страна */
  c: string;
  /** жанры */
  g: string[];
  /** сезон */
  se?: number;
  /** просмотрено серий / прочитано глав (у фильма 0/1 по статусу); счёт идёт по главам и у книг */
  ep: number;
  /** всего серий/глав; 0 — неизвестно */
  tot: number;
  /** том (манга, книги, аудиокниги) */
  vol?: number;
  /** автор / мангака / писатель */
  author?: string;
  /** озвучка или перевод */
  tr?: string;
  /** ссылка на источник */
  link?: string;
  /** оценка 0–10, 0 = нет */
  rate?: number;
  /** личная заметка или рецензия (одна на тайтл) */
  note?: string;
  /** оттенки градиента заглушки постера */
  h: [number, number];
}

export type AirStatus = "o" | "d" | "s";

/** Запись общего каталога (раздел «Обзор») */
export interface CatalogItem {
  id: number;
  type: TitleType;
  t: string;
  en: string;
  y: number;
  g: string[];
  c: string;
  r: number;
  p: number;
  s: AirStatus;
  tot: number;
  h: number;
}

/** Тайтл, найденный живым поиском во внешних каталогах (TMDB, Shikimori, Open Library); в библиотеке его ещё нет */
export interface CatalogResult {
  /** источник:внешний id:категория — уникальный ключ в списке */
  key: string;
  source: string;
  extId: string;
  type: TitleType;
  t: string;
  en?: string;
  y: number;
  g: string[];
  c: string;
  author?: string;
  /** внешний URL постера (после добавления сервер скачивает его в свою папку) */
  img?: string;
  /** оценка источника по 10-балльной шкале; нет у части источников */
  rating?: number;
}

/** Вариант из внешнего API для ручного обогащения карточки (GET /items/{id}/enrich/candidates) */
export interface EnrichCandidate {
  /** источник:внешний id — уникальный ключ в списке */
  key: string;
  source: string;
  extId: string;
  t: string;
  en?: string;
  y: number;
  g: string[];
  c: string;
  author?: string;
  /** внешний URL постера */
  img?: string;
}

/** Строка распределения из GET /stats: записей и единиц прогресса (серий, глав, фильмов) */
export interface StatsRow {
  name: string;
  items: number;
  progress: number;
}

/** Серии, главы и фильмы считаются раздельно */
export interface StatsMarks {
  episodes: number;
  chapters: number;
  movies: number;
}

/** Данные экрана «Статистика» и графика «Эта неделя» (GET /stats) */
export interface Stats {
  /** период журнала, YYYY-MM-DD включительно */
  from: string;
  to: string;
  totalItems: number;
  genres: StatsRow[];
  countries: StatsRow[];
  years: { year: number; items: number; progress: number }[];
  /** топ записей по накопленному прогрессу */
  top: { id: number; title: string; en?: string; type: TitleType; progress: number }[];
  /** накоплено по библиотеке */
  totals: StatsMarks;
  /** отметки журнала по дням периода (пустые дни = 0) */
  activity: { date: string; count: number }[];
  /** отметки журнала за период по видам */
  marks: StatsMarks;
}

export type LogUnit = "ep" | "ch" | "film";

export interface LogEntry {
  /** id записи журнала на сервере (нет у демо-данных) */
  id?: number;
  day: string;
  title: string;
  ep: number;
  time: string;
  u?: LogUnit;
}
