"use client";

import { useEffect } from "react";
import { useStore } from "./store";

/**
 * Статистика с сервера для текущей недели. Грузится после загрузки библиотеки и обновляется при изменениях:
 * ключ меняется, когда добавляются или удаляются записи и когда в ленте появляется или пропадает отметка
 * (в том числе когда временная запись получает id от сервера, то есть после записи в БД).
 */
export function useStats() {
  const stats = useStore((s) => s.stats);
  const statsError = useStore((s) => s.statsError);
  const loadStats = useStore((s) => s.loadStats);
  const hydrated = useStore((s) => s.hydrated);
  const key = useStore((s) => `${s.items.length}:${s.log.length}:${s.log[0]?.id ?? 0}`);

  useEffect(() => {
    if (hydrated) void loadStats();
  }, [hydrated, key, loadStats]);

  return { stats, statsError, reload: loadStats };
}
