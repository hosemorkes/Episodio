/** Решение гарда доступа (src/proxy.ts): чистая функция, чтобы правила можно было проверять тестами */
export type GuardResult =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

/**
 * Публичные адреса витрин, доступные без входа: страница /u/<имя>/<адрес> и её постеры /u/<имя>/<адрес>/poster/<файл>.
 * Строго эти два вида путей: любой другой адрес под /u/ закрыт сессией, как и всё остальное.
 */
const PUBLIC_PATH = /^\/u\/[a-z0-9_-]{1,32}\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/poster\/[A-Za-z0-9._-]+)?\/?$/;
export const isPublicPath = (pathname: string) => PUBLIC_PATH.test(pathname);

/**
 * Всё, кроме /login и /api/auth (их исключает matcher), доступно только с действующей сессией.
 * Для /api/* без сессии — 401 (в том числе для прокси /api/backend/*), для страниц — переход на /login.
 */
export function guardDecision(pathname: string, search: string, loggedIn: boolean): GuardResult {
  if (pathname === "/login") {
    // Уже вошли — на главную
    return loggedIn ? { action: "redirect", to: "/" } : { action: "next" };
  }
  if (loggedIn || isPublicPath(pathname)) return { action: "next" };
  if (pathname.startsWith("/api/")) return { action: "unauthorized" };

  const next = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return { action: "redirect", to: `/login${next}` };
}
