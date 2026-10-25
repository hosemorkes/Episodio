import { NextResponse, type NextRequest } from "next/server";
import { checkCredentials, createSession, readAuthConfig, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth";

// Защита от перебора: не больше 5 неудачных попыток в минуту с одного адреса (в памяти процесса)
const WINDOW_MS = 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

function tooMany(ip: string, now: number) {
  const recent = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  fails.set(ip, recent);
  return recent.length >= MAX_FAILS;
}

export async function POST(req: NextRequest) {
  const cfg = readAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      { detail: "Вход не настроен: задайте AUTH_LOGIN, AUTH_PASSWORD и AUTH_SECRET в .env" },
      { status: 503 },
    );
  }

  let body: { login?: unknown; password?: unknown; remember?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Некорректный запрос" }, { status: 400 });
  }
  const login = typeof body.login === "string" ? body.login : "";
  const password = typeof body.password === "string" ? body.password : "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  if (tooMany(ip, now)) {
    return NextResponse.json({ detail: "Слишком много попыток, подождите минуту" }, { status: 429 });
  }

  if (!(await checkCredentials(cfg, login, password))) {
    fails.set(ip, [...(fails.get(ip) ?? []), now]);
    return NextResponse.json({ detail: "Неверный логин или пароль" }, { status: 401 });
  }

  fails.delete(ip);
  const remember = body.remember !== false;
  const res = NextResponse.json({ login: cfg.login });
  res.cookies.set(SESSION_COOKIE, await createSession(cfg, SESSION_DAYS, now), {
    httpOnly: true,
    sameSite: "lax",
    // Secure только за https: на http (например, проверка с телефона по локальной сети) cookie иначе не сохранится
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    // «Запомнить меня» выключено — cookie живёт до закрытия браузера
    ...(remember ? { maxAge: SESSION_DAYS * 86400 } : {}),
  });
  return res;
}
