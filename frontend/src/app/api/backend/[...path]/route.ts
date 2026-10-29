import { NextResponse, type NextRequest } from "next/server";
import { apiBaseUrl, downstreamHeaders, upstreamHeaders, upstreamUrl } from "@/lib/backend-proxy";

// Прокси к FastAPI: ключ X-API-Key подставляется здесь, на сервере, и в браузер не попадает.
// Доступ только с действующей сессией (её проверяет src/proxy.ts); картинки постеров идут тем же путём.
// Тело ответа (res.body) передаётся потоком без накопления: так по SSE текст Эпи доходит по мере генерации.
type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  const url = upstreamUrl(apiBaseUrl(), path, req.nextUrl.search);
  if (!url) return NextResponse.json({ detail: "Неизвестный путь" }, { status: 404 });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers: upstreamHeaders(req.headers, process.env.API_KEY?.trim()),
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      // Закрыл вкладку или нажал «стоп» — обрываем и запрос к FastAPI (важно для потока ответа Эпи)
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ detail: "Бэкенд недоступен: проверьте, что запущен uvicorn и верен API_URL" }, { status: 502 });
  }
  return new NextResponse(res.status === 204 || res.status === 304 ? null : res.body, {
    status: res.status,
    headers: downstreamHeaders(res.headers),
  });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
