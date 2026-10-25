"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { CatalogResult, TitleType } from "./types";

export interface CatalogSearchState {
  /** запрос достаточно длинный, поиск включён */
  active: boolean;
  busy: boolean;
  results: CatalogResult[];
  /** источники, которые не ответили (остальные результаты при этом показываются) */
  warnings: string[];
  /** поиск не удался целиком */
  error: string | null;
}

const IDLE: CatalogSearchState = { active: false, busy: false, results: [], warnings: [], error: null };

/** Минимальная длина запроса: короче сервер не принимает */
export const MIN_QUERY = 2;
const DEBOUNCE_MS = 600;

/**
 * Живой поиск по внешним каталогам с задержкой, чтобы не искать на каждую букву.
 * Устаревшие ответы (запрос уже изменился) отбрасываются.
 */
export function useCatalogSearch(query: string, type: TitleType | "all", enabled: boolean, source?: string): CatalogSearchState {
  const [state, setState] = useState<CatalogSearchState>(IDLE);
  const term = query.trim();
  const on = enabled && term.length >= MIN_QUERY;

  useEffect(() => {
    if (!on) {
      setState(IDLE);
      return;
    }
    let stale = false;
    setState((s) => ({ ...s, active: true, busy: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const r = await api.searchCatalog(term, type === "all" ? undefined : type, undefined, source);
        if (!stale) setState({ active: true, busy: false, results: r.results, warnings: r.errors, error: null });
      } catch (e) {
        if (!stale) setState({ active: true, busy: false, results: [], warnings: [], error: e instanceof ApiError ? e.message : "Не удалось выполнить поиск" });
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [on, term, type, source]);

  // В первом кадре после ввода состояние ещё не обновилось: сразу показываем «ищем», без вспышки пустого экрана
  return on ? (state.active ? state : { ...IDLE, active: true, busy: true }) : IDLE;
}
