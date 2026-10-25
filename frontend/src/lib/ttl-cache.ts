/** Маленький кэш с временем жизни записи. Время передаётся извне, чтобы его можно было проверять тестами */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now) {
  const map = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at >= ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      map.set(key, { at: now(), value });
    },
    clear() {
      map.clear();
    },
  };
}
