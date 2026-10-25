import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { publicHandle } from "@/lib/public-showcase";

export async function GET(req: NextRequest) {
  const cfg = readAuthConfig();
  const login = cfg ? await verifySession(cfg, req.cookies.get(SESSION_COOKIE)?.value) : null;
  if (!login) return NextResponse.json({ detail: "Требуется вход" }, { status: 401 });
  // handle — имя в публичных ссылках /u/<handle>/…; логин для входа в ссылки не попадает
  return NextResponse.json({ login, handle: publicHandle() });
}
