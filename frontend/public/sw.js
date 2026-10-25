// Service worker Episodio: stale-while-revalidate для статики, офлайн-фолбэк для страниц.
// Авторизация и API не кэшируются.
const CACHE = "episodio-v2";
const PRECACHE = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.svg"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Страницы: сеть, при отсутствии сети — последняя сохранённая версия
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Редирект (например, на /login при выходе) не кэшируем под адресом защищённой страницы
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  // Статика (_next, шрифты, иконки): из кэша и обновление в фоне
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    ),
  );
});
