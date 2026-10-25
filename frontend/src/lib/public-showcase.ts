/**
 * Публичные витрины на стороне сервера Next.js: адрес владельца, адреса постеров и загрузка данных из FastAPI.
 * Браузерный прокси /api/backend здесь не используется: страница рендерится на сервере и ходит в API сама, с ключом.
 */
import { toShowcaseView, type ApiShowcaseView } from "./api";
import { apiBaseUrl } from "./backend-proxy";
import type { ShowcaseView } from "./types";

/** Имя владельца в публичной ссылке /u/<имя>/<адрес>, если PUBLIC_HANDLE не задан. Логин для входа в ссылку не попадает */
export const DEFAULT_HANDLE = "me";

const HANDLE_RE = /^[a-z0-9_-]{1,32}$/;

/** Публичное имя из PUBLIC_HANDLE (строчные латинские буквы, цифры, «-» и «_»); неверное значение заменяется именем по умолчанию */
export function publicHandle(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.PUBLIC_HANDLE ?? "").trim().toLowerCase();
  return HANDLE_RE.test(raw) ? raw : DEFAULT_HANDLE;
}

/**
 * Адрес постера для публичной страницы. Постеры из библиотеки FastAPI отдаёт по /public/showcases/<slug>/posters/<файл>,
 * браузеру они доступны через маршрут страницы /u/<user>/<slug>/poster/<файл>; внешние https-адреса остаются как есть,
 * всё остальное (в том числе чужие пути) не показывается.
 */
export function publicPosterSrc(user: string, slug: string, poster: string | null): string | undefined {
  if (!poster) return undefined;
  const prefix = `/public/showcases/${slug}/posters/`;
  if (poster.startsWith(prefix)) {
    const file = poster.slice(prefix.length);
    return /^[A-Za-z0-9._-]+$/.test(file) ? `/u/${user}/${slug}/poster/${file}` : undefined;
  }
  return /^https?:\/\//i.test(poster) ? poster : undefined;
}

/**
 * Адрес сайта, с которого пришёл запрос (для абсолютных ссылок в превью: соцсети не понимают относительные).
 * За обратным прокси берутся x-forwarded-proto и x-forwarded-host, иначе host запроса.
 */
export function originFrom(get: (name: string) => string | null | undefined): string {
  const first = (v: string | null | undefined) => (v ?? "").split(",")[0].trim();
  const raw = first(get("x-forwarded-host")) || first(get("host"));
  const host = /^[A-Za-z0-9.\-:[\]]+$/.test(raw) ? raw : "localhost:3000"; // в ссылку попадает только похожее на адрес
  const proto = first(get("x-forwarded-proto")) || (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** Заголовки запроса к FastAPI с ключом (он нужен всем эндпоинтам, публичные тоже закрыты им от прямого обращения) */
export function upstreamAuth(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const key = (env.API_KEY ?? "").trim();
  return key ? { "X-API-Key": key } : {};
}

/** Витрина для публичной страницы; null — её нет или она отключена (FastAPI отвечает одинаково) */
export async function fetchPublicShowcase(user: string, slug: string): Promise<ShowcaseView | null> {
  const res = await fetch(`${apiBaseUrl()}/public/showcases/${encodeURIComponent(slug)}`, { headers: upstreamAuth(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Витрина недоступна (${res.status})`);
  return toShowcaseView((await res.json()) as ApiShowcaseView, (p) => publicPosterSrc(user, slug, p));
}
