import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const cfg = readAuthConfig();
  const login = cfg ? await verifySession(cfg, req.cookies.get(SESSION_COOKIE)?.value) : null;
  if (!login) return NextResponse.json({ detail: "Требуется вход" }, { status: 401 });
  return NextResponse.json({ login });
}
