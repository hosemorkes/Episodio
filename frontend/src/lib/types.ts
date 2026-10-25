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
