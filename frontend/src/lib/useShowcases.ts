"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Showcase, ShowcaseDraft, ShowcaseView } from "./types";

/** Ошибка запроса витрин: сессия закончилась — на вход, остальное возвращается текстом для показа */
export function showcaseError(e: unknown): string {
  if (e instanceof ApiError && e.status === 401 && typeof window !== "undefined") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  return e instanceof ApiError ? e.message : "Не удалось выполнить действие";
}

/** Список витрин с сервера: загружается при открытии экрана; изменения применяет сам экран через setList */
export function useShowcaseList() {
  const [list, setList] = useState<Showcase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await api.listShowcases());
    } catch (e) {
      setError(showcaseError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { list, setList, error, reload: load };
}

const PREVIEW_DELAY_MS = 350;

export interface PreviewState {
  view: ShowcaseView | null;
  busy: boolean;
  error: string | null;
}

/**
 * Предпросмотр витрины по параметрам черновика (POST /showcases/preview). Запрос уходит через паузу после последнего
 * изменения; устаревшие ответы отбрасываются, прежний предпросмотр остаётся на экране, пока приходит новый.
 */
export function useShowcasePreview(draft: ShowcaseDraft | null): PreviewState {
  const [state, setState] = useState<PreviewState>({ view: null, busy: false, error: null });
  const key = draft ? JSON.stringify(draft) : "";

  useEffect(() => {
    if (!draft) {
      setState({ view: null, busy: false, error: null });
      return;
    }
    let stale = false;
    setState((s) => ({ ...s, busy: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const view = await api.previewShowcase(draft);
        if (!stale) setState({ view, busy: false, error: null });
      } catch (e) {
        if (!stale) setState((s) => ({ view: s.view, busy: false, error: showcaseError(e) }));
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft сравнивается по содержимому (key)
  }, [key]);

  return state;
}
