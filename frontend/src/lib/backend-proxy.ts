/** Чистые функции прокси Next.js -> FastAPI (сам обработчик: src/app/api/backend/[...path]/route.ts) */

/** Адрес FastAPI: API_URL из .env, по умолчанию локальный uvicorn */
export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.API_URL ?? "").trim() || "http://127.0.0.1:8000";
  return raw.replace(/\/+$/, "");
}

/** Что можно запрашивать через прокси: остальные пути FastAPI (docs, openapi) наружу не отдаём */
const ALLOWED_ROOTS = new Set(["items", "genres", "log", "stats", "catalog", "posters", "health"]);

/**
 * Адрес запроса к FastAPI или null, если путь не разрешён.
 * Каждый сегмент кодируется, «..» и пустые сегменты отклоняются: прокси не должен ходить дальше API.
 */
export function upstreamUrl(base: string, segments: string[], search = ""): string | null {
  if (!segments.length || !ALLOWED_ROOTS.has(segments[0])) return null;
  if (segments.some((s) => s === "" || s === "." || s === ".." || /[/\\]/.test(s))) return null;
  const path = segments.map(encodeURIComponent).join("/");
  // Next убирает завершающий «/», а список и создание в FastAPI висят на /items/ (без него будет редирект)
  const tail = segments.length === 1 && segments[0] === "items" ? "/" : "";
  return `${base}/${path}${tail}${search}`;
}

/** Заголовки к FastAPI: тип содержимого, Accept и ключ API (его в браузер не отдаём, он только здесь) */
export function upstreamHeaders(incoming: Headers, apiKey?: string): Headers {
  const out = new Headers();
  for (const name of ["content-type", "accept", "if-none-match", "if-modified-since"]) {
    const v = incoming.get(name);
    if (v) out.set(name, v);
  }
  if (apiKey) out.set("X-API-Key", apiKey);
  return out;
}

/** Заголовки ответа, которые стоит отдать браузеру (в первую очередь кэш постеров) */
export function downstreamHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const name of ["content-type", "cache-control", "etag", "last-modified"]) {
    const v = upstream.get(name);
    if (v) out.set(name, v);
  }
  return out;
}
