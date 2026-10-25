"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { SHELF_SIZE } from "./shelves";
import { createTtlCache } from "./ttl-cache";
import type { CatalogResult, TitleType } from "./types";

export interface PopularState {
  /** idle — выключено, loading — идёт запрос, ready — подборка получена, error — не удалось */
  status: "idle" | "loading" | "ready" | "error";
  results: CatalogResult[];
  /** источники, которые не ответили (остальные результаты при этом есть) */
  warnings: string[];
  error: string | null;
  /** повторить запрос после ошибки */
  retry: () => void;
}

interface Loaded {
  results: CatalogResult[];
  warnings: string[];
}

/** Подборка на сервере кэшируется на час; в браузере держим её 10 минут, чтобы переключение вкладок не дёргало API */
const cache = createTtlCache<Loaded>(10 * 60_000);

/**
 * Живая подборка для полок «Обзора» (GET /catalog/popular) по выбранному типу.
 * Устаревшие ответы (вкладка уже сменилась) отбрасываются; при ошибке страница показывает статическую подборку.
 */
export function useCatalogPopular(type: TitleType | "all", enabled: boolean, source?: string): PopularState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<PopularState, "retry"> & { key: string }>({ key: "", status: "idle", results: [], warnings: [], error: null });
  const retry = useCallback(() => {
    cache.clear();
    setAttempt((n) => n + 1);
  }, []);
  const key = `${type}:${source ?? ""}:${attempt}`;
  const cacheKey = `${type}:${source ?? ""}`;
  const cached = enabled ? cache.get(cacheKey) : undefined;

  useEffect(() => {
    if (!enabled || cache.get(cacheKey)) return;
    let stale = false;
    setState({ key, status: "loading", results: [], warnings: [], error: null });
    api
      .popularCatalog(type === "all" ? undefined : type, SHELF_SIZE, source)
      .then((r) => {
        cache.set(cacheKey, { results: r.results, warnings: r.errors });
        if (!stale) setState({ key, status: "ready", results: r.results, warnings: r.errors, error: null });
      })
      .catch((e) => {
        if (!stale) setState({ key, status: "error", results: [], warnings: [], error: e instanceof ApiError ? e.message : "Не удалось загрузить подборку" });
      });
    return () => {
      stale = true;
    };
  }, [enabled, type, key, source, cacheKey]);

  if (!enabled) return { status: "idle", results: [], warnings: [], error: null, retry };
  if (cached) return { status: "ready", ...cached, error: null, retry };
  // В первом кадре после смены вкладки состояние ещё от прошлой: сразу показываем «загрузка»
  if (state.key !== key) return { status: "loading", results: [], warnings: [], error: null, retry };
  return { ...state, retry };
}
