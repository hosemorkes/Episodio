import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth";

/** Гард: всё, кроме /login и /api/auth, доступно только с действующей сессией */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const cfg = readAuthConfig();
  const user = cfg ? await verifySession(cfg, req.cookies.get(SESSION_COOKIE)?.value) : null;

  if (pathname === "/login") {
    // Уже вошли — на главную
    return user ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "Требуется вход" }, { status: 401 });
  }
  const url = new URL("/login", req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Исключения: служебные файлы Next, PWA и брендовые иконки
  matcher: ["/((?!api/auth|_next/static|_next/image|brand|icons|favicon|apple-touch-icon|manifest\\.webmanifest|sw\\.js).*)"],
};
