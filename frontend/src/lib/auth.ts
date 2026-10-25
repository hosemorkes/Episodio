/**
 * Сессия: подписанный HMAC-токен в httpOnly-cookie.
 * Логин, пароль и секрет берутся из .env (AUTH_LOGIN, AUTH_PASSWORD, AUTH_SECRET).
 * Только Web Crypto — модуль работает и в route handlers, и в proxy.
 */
export const SESSION_COOKIE = "episodio_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

export interface AuthConfig {
  login: string;
  password: string;
  secret: string;
}

/** Настройки из окружения; null — вход не настроен (эндпоинт ответит 503) */
export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const login = env.AUTH_LOGIN?.trim();
  const password = env.AUTH_PASSWORD;
  const secret = env.AUTH_SECRET;
  if (!login || !password || !secret) return null;
  return { login, password, secret };
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Сравнение за постоянное время, чтобы не подсказывать длину совпавшего префикса */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function checkCredentials(cfg: AuthConfig, login: string, password: string) {
  // Оба сравнения выполняются всегда, результат объединяется после
  const okLogin = safeEqual(login.trim().toLowerCase(), cfg.login.toLowerCase());
  const okPass = safeEqual(password, cfg.password);
  return okLogin && okPass;
}

/** Токен вида `логин.срок.подпись` (логин в base64url, срок — unix-секунды) */
export async function createSession(cfg: AuthConfig, days = SESSION_DAYS, now = Date.now()) {
  const user = btoa(unescape(encodeURIComponent(cfg.login))).replace(/=+$/, "");
  const exp = Math.floor(now / 1000) + days * 86400;
  const payload = `${user}.${exp}`;
  return `${payload}.${await sign(cfg.secret, payload)}`;
}

/** Возвращает логин, если токен подлинный и не просрочен */
export async function verifySession(cfg: AuthConfig, token: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [user, exp, sig] = parts;
  if (!safeEqual(sig, await sign(cfg.secret, `${user}.${exp}`))) return null;
  if (!(Number(exp) > Math.floor(now / 1000))) return null;
  try {
    return decodeURIComponent(escape(atob(user)));
  } catch {
    return null;
  }
}
