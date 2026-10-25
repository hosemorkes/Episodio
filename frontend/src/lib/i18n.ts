"use client";

import { useCallback } from "react";
import { translate } from "./i18n-core";
import type { Tr } from "./rules";
import { useStore } from "./store";

/** Хук перевода: t("русская строка") → строка на текущем языке */
export function useT(): Tr {
  const lang = useStore((s) => s.lang);
  return useCallback((ru: string) => translate(lang, ru), [lang]);
}

export const useLang = () => useStore((s) => s.lang);
