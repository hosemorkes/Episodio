import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { guardDecision } from "@/lib/guard";

/** Гард: всё, кроме /login и /api/auth, доступно только с действующей сессией (правила: lib/guard.ts) */
export async function proxy(req: NextRequest) {
  const cfg = readAuthConfig();
  const user = cfg ? await verifySession(cfg, req.cookies.get(SESSION_COOKIE)?.value) : null;

  const decision = guardDecision(req.nextUrl.pathname, req.nextUrl.search, !!user);
  if (decision.action === "unauthorized") return NextResponse.json({ detail: "Требуется вход" }, { status: 401 });
  if (decision.action === "redirect") return NextResponse.redirect(new URL(decision.to, req.url));
  return NextResponse.next();
}

export const config = {
  // Исключения: служебные файлы Next, PWA и брендовые иконки
  matcher: ["/((?!api/auth|_next/static|_next/image|brand|icons|favicon|apple-touch-icon|manifest\\.webmanifest|sw\\.js).*)"],
};
