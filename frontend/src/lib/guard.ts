/** Решение гарда доступа (src/proxy.ts): чистая функция, чтобы правила можно было проверять тестами */
export type GuardResult =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

/**
 * Всё, кроме /login и /api/auth (их исключает matcher), доступно только с действующей сессией.
 * Для /api/* без сессии — 401 (в том числе для прокси /api/backend/*), для страниц — переход на /login.
 */
export function guardDecision(pathname: string, search: string, loggedIn: boolean): GuardResult {
  if (pathname === "/login") {
    // Уже вошли — на главную
    return loggedIn ? { action: "redirect", to: "/" } : { action: "next" };
  }
  if (loggedIn) return { action: "next" };
  if (pathname.startsWith("/api/")) return { action: "unauthorized" };

  const next = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return { action: "redirect", to: `/login${next}` };
}
