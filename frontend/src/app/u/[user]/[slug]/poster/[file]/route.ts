import { apiBaseUrl } from "@/lib/backend-proxy";
import { publicHandle, upstreamAuth } from "@/lib/public-showcase";

// Постер публичной витрины. Открыт без входа, поэтому проверяет сам: имя владельца, формат адреса и файла; остальное решает FastAPI
// (он отдаёт только постеры записей, которые входят в эту публичную витрину)
type Ctx = { params: Promise<{ user: string; slug: string; file: string }> };

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const { user, slug, file } = await params;
  if (user !== publicHandle() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[A-Za-z0-9._-]+$/.test(file) || file.includes("..")) return notFound();

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/public/showcases/${slug}/posters/${encodeURIComponent(file)}`, { headers: upstreamAuth(), cache: "no-store" });
  } catch {
    return notFound();
  }
  if (!res.ok) return notFound(); // причина (нет витрины, отключена, чужой файл) наружу не раскрывается

  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
