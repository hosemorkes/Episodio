"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, ApiError, CATEGORY_TO_API, fromServerExport } from "./api";
import { translate } from "./i18n-core";
import { fixSt, hasSeasons, isReading, parseBackup, statusPatch, unitOf } from "./rules";
import { isPublicPath } from "./guard";
import { weekRange } from "./stats";
import type { CatalogItem, CatalogResult, EnrichCandidate, Lang, LogEntry, Stats, Theme, Title, TitleStatus, TitleType } from "./types";

export interface TitleDraft {
  id: number | null;
  type: TitleType;
  t: string;
  en: string;
  desc: string;
  img: string;
  se: string;
  y: string;
  ep: string;
  tot: string;
  vol: string;
  author: string;
  tr: string;
  link: string;
  c: string;
  rate: number;
  g: string[];
}

interface State {
  /** библиотека: источник правды — сервер, здесь её копия с оптимистичными правками */
  items: Title[];
  /** лента активности, свежие первыми; подгружается страницами */
  log: LogEntry[];
  /** в ленте больше нечего подгружать */
  logEnd: boolean;
  lastId: number | null;
  savedAt: number;
  theme: Theme;
  lang: Lang;
  /** первая загрузка данных с сервера завершена (до этого показываем скелетоны) */
  hydrated: boolean;
  /** данные успешно получены с сервера хотя бы раз */
  loaded: boolean;
  /** текст ошибки последней неудачной загрузки; null — всё в порядке */
  loadError: string | null;
  /** статистика сервера за текущую неделю (GET /stats); null до первого ответа */
  stats: Stats | null;
  /** текст ошибки последней загрузки статистики; null — всё в порядке */
  statsError: string | null;
  /** id карточки, у которой играет анимация «+» */
  pulse: number | null;
  toast: string;
  palOpen: boolean;

  say: (msg: string) => void;
  setPalOpen: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
  load: () => Promise<void>;
  ensureLoaded: () => void;
  loadMoreLog: () => Promise<void>;
  loadStats: () => Promise<void>;
  mark: (id: number) => void;
  minus: (id: number) => void;
  setStatus: (id: number, st: TitleStatus) => void;
  setSeason: (id: number, n: number) => void;
  setVolume: (id: number, n: number) => void;
  setRate: (id: number, n: number) => void;
  setNote: (id: number, text: string) => void;
  saveTitle: (draft: TitleDraft) => Promise<number | null>;
  deleteTitle: (id: number) => void;
  addFromCatalog: (c: CatalogItem, st: TitleStatus) => Promise<void>;
  addFromSearch: (r: CatalogResult, st: TitleStatus) => Promise<boolean>;
  /** Варианты обогащения из внешнего источника; ошибки бросаются наверх, окно показывает их само */
  enrichCandidates: (id: number, source?: string) => Promise<EnrichCandidate[]>;
  /** Применяет вариант к карточке и обновляет её в библиотеке; возвращает заполненные поля БД */
  enrichApply: (id: number, c: EnrichCandidate, replacePoster: boolean) => Promise<string[]>;
  restore: (data: unknown) => Promise<boolean>;
  markBackup: () => void;
}

const LOG_PAGE = 20;

const tr = (ru: string) => translate(useStore.getState().lang, ru);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
/** идёт первая/повторная загрузка данных и подгрузка ленты (защита от параллельных запросов) */
let loading = false;
let logBusy = false;
/** номер последнего запроса статистики: ответ на более старый запрос отбрасывается */
let statsSeq = 0;

const num = (v: string, d: number) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? d : n;
};

export function emptyDraft(): TitleDraft {
  return { id: null, type: "anime", t: "", en: "", desc: "", img: "", se: "1", y: String(new Date().getFullYear()), ep: "0", tot: "12", vol: "", author: "", tr: "", link: "", c: "Япония", rate: 0, g: [] };
}

export function draftOf(it: Title): TitleDraft {
  return {
    id: it.id, type: it.type, t: it.t, en: it.en ?? "", desc: it.desc ?? "", img: it.img ?? "", se: String(it.se ?? 1),
    y: String(it.y), ep: String(it.ep), tot: it.tot > 0 ? String(it.tot) : "", vol: it.vol ? String(it.vol) : "", author: it.author ?? "", tr: it.tr ?? "", link: it.link ?? "",
    c: it.c, rate: it.rate ?? 0, g: [...it.g],
  };
}

// ---------- Очередь сетевых операций ----------

// Операции над одним тайтлом выполняются строго по очереди: быстрые «+» подряд не обгоняют друг друга,
// а ответ сервера применяется к карточке, только когда в очереди не осталось более новых действий
const chains = new Map<number, Promise<void>>();
const pending = new Map<number, number>();

function enqueue<T>(id: number, op: () => Promise<T>): Promise<T> {
  pending.set(id, (pending.get(id) ?? 0) + 1);
  const result = (chains.get(id) ?? Promise.resolve()).then(op);
  const tail: Promise<void> = result
    .then(() => undefined, () => undefined)
    .then(() => {
      const left = (pending.get(id) ?? 1) - 1;
      if (left > 0) pending.set(id, left);
      else {
        pending.delete(id);
        if (chains.get(id) === tail) chains.delete(id);
      }
    });
  chains.set(id, tail);
  return result;
}

/** Выполняется последняя операция в очереди этого тайтла (после неё локальное состояние можно сверять с сервером) */
const isLastInQueue = (id: number) => (pending.get(id) ?? 0) <= 1;

// ---------- Вспомогательные действия над состоянием ----------

const setItems = (fn: (items: Title[]) => Title[]) => useStore.setState((s) => ({ items: fn(s.items) }));
const replaceItem = (it: Title) => setItems((items) => items.map((x) => (x.id === it.id ? it : x)));

/** Ошибка действия: сессия закончилась — на вход, остальное показываем тостом */
function fail(e: unknown) {
  if (e instanceof ApiError && e.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  useStore.getState().say(e instanceof ApiError ? e.message : tr("Не удалось выполнить действие"));
}

async function reloadLog() {
  try {
    const log = await api.listLog({ limit: LOG_PAGE });
    useStore.setState({ log, logEnd: log.length < LOG_PAGE });
  } catch {
    /* лента подтянется при следующей загрузке */
  }
}

/** После неудачи берём состояние тайтла с сервера, чтобы не расходиться с БД */
async function resync(id: number) {
  try {
    replaceItem(await api.getItem(id));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) setItems((items) => items.filter((x) => x.id !== id));
  }
  await reloadLog();
}

/** Постер из формы: новый (dataURL) загружается на сервер, убранный — удаляется; остальное не трогаем */
async function syncPoster(saved: Title, img: string, prevImg: string | undefined): Promise<Title> {
  if (img.startsWith("data:")) {
    const blob = await (await fetch(img)).blob();
    return api.uploadPoster(saved.id, new File([blob], "poster.jpg", { type: blob.type || "image/jpeg" }));
  }
  if (!img && prevImg) return api.deletePoster(saved.id);
  return saved;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Любое действие над тайтлом обновляет lastId — это карточка «Продолжить» */
      const upd = (id: number, fn: (x: Title) => Title) =>
        set((s) => ({ lastId: id, items: s.items.map((x) => (x.id === id ? fn(x) : x)) }));

      /** Отправляет изменения на сервер; при ошибке — тост и сверка с сервером */
      const send = (id: number, op: () => Promise<Title>, after?: () => void) =>
        void enqueue(id, async () => {
          try {
            const saved = await op();
            if (isLastInQueue(id)) replaceItem(saved);
            after?.();
          } catch (e) {
            fail(e);
            await resync(id);
          }
        });

      return {
        items: [],
        log: [],
        logEnd: false,
        lastId: null,
        savedAt: 0,
        theme: "dark",
        lang: "ru",
        hydrated: false,
        loaded: false,
        loadError: null,
        stats: null,
        statsError: null,
        pulse: null,
        toast: "",
        palOpen: false,

        say: (msg) => {
          set({ toast: msg });
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => set({ toast: "" }), 2000);
        },
        setPalOpen: (v) => set({ palOpen: v }),
        setTheme: (theme) => {
          set({ theme });
          applyTheme(theme);
        },
        setLang: (lang) => {
          set({ lang });
          document.documentElement.setAttribute("lang", lang);
          try { localStorage.setItem("episodio-lang", lang); } catch { /* приватный режим */ }
        },

        load: async () => {
          try {
            const [items, log] = await Promise.all([api.listItems(), api.listLog({ limit: LOG_PAGE })]);
            set({ items, log, logEnd: log.length < LOG_PAGE, loaded: true, loadError: null, hydrated: true });
          } catch (e) {
            const message = e instanceof ApiError ? e.message : tr("Не удалось загрузить данные");
            set({ loadError: message, hydrated: true });
            fail(e);
          }
        },
        ensureLoaded: () => {
          if (!get().loaded && !loading) {
            loading = true;
            void get().load().finally(() => (loading = false));
          }
        },
        loadMoreLog: async () => {
          const { log, logEnd } = get();
          const last = log.at(-1);
          if (logEnd || logBusy || !last?.id) return;
          logBusy = true;
          try {
            const more = await api.listLog({ limit: LOG_PAGE, before: last.id });
            set((s) => ({ log: [...s.log, ...more], logEnd: more.length < LOG_PAGE }));
          } catch (e) {
            fail(e);
          } finally {
            logBusy = false;
          }
        },

        loadStats: async () => {
          const seq = ++statsSeq;
          const { from, to } = weekRange(new Date());
          try {
            const stats = await api.getStats({ from, to, limit: 10 });
            if (seq === statsSeq) set({ stats, statsError: null });
          } catch (e) {
            if (seq !== statsSeq) return;
            set({ statsError: e instanceof ApiError ? e.message : tr("Не удалось загрузить данные") });
            if (e instanceof ApiError && e.status === 401) fail(e);
          }
        },

        mark: (id) => {
          const it = get().items.find((x) => x.id === id);
          if (!it) return;
          const u = unitOf(it.type, tr);
          if (it.tot > 0 && it.ep >= it.tot) {
            get().say(`${it.t}: ${u.done}`);
            return;
          }
          const d = new Date();
          const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          const ep = it.ep + 1;
          const entry: LogEntry = { day: "СЕГОДНЯ", title: it.t, ep, u: u.u, time };
          set((s) => ({
            items: s.items.map((x) => (x.id === id ? { ...x, ep, st: fixSt(x.st, ep, x.tot) } : x)),
            pulse: id,
            lastId: id,
            log: [entry, ...s.log],
          }));
          clearTimeout(pulseTimer);
          pulseTimer = setTimeout(() => set({ pulse: null }), 220);
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
          get().say(it.t + u.toast + (it.type === "movie" ? "" : ep));

          void enqueue(id, async () => {
            try {
              if (it.type === "movie") {
                // У фильма нет счётчика: сервер сам пишет просмотр в журнал при переходе в completed
                const saved = await api.patchItem(id, { status: "completed" });
                if (isLastInQueue(id)) replaceItem(saved);
                await reloadLog();
                return;
              }
              const r = await api.progress(id, 1);
              if (isLastInQueue(id)) replaceItem(r.item);
              // временная запись заменяется настоящей (с id для подгрузки ленты)
              if (r.entry) set((s) => ({ log: s.log.map((e) => (e === entry ? r.entry! : e)) }));
            } catch (e) {
              fail(e);
              await resync(id);
            }
          });
        },
        minus: (id) => {
          const it = get().items.find((x) => x.id === id);
          if (!it) return;
          if (it.type === "movie") {
            // Фильм «откатывается» сменой статуса: сервер удалит последнюю запись журнала
            if (it.st === "done") get().setStatus(id, "planned");
            return;
          }
          // Последняя запись журнала по этому тайтлу уходит вместе с отметкой (как на сервере)
          const at = get().log.findIndex((e) => e.title === it.t);
          set((s) => ({
            lastId: id,
            items: s.items.map((x) => (x.id === id ? { ...x, ep: Math.max(0, x.ep - 1), st: x.st === "done" ? "watching" : x.st } : x)),
            log: at >= 0 ? s.log.filter((_, i) => i !== at) : s.log,
          }));
          void enqueue(id, async () => {
            try {
              const r = await api.progress(id, -1);
              if (isLastInQueue(id)) replaceItem(r.item);
            } catch (e) {
              fail(e);
              await resync(id);
            }
          });
        },
        setStatus: (id, st) => {
          const it = get().items.find((x) => x.id === id);
          if (!it) return;
          const next = statusPatch(it, st);
          upd(id, () => next);
          // Журнал фильма ведёт сервер, поэтому после смены статуса фильма читаем его заново
          send(id, () => api.updateItem(id, next), it.type === "movie" ? () => void reloadLog() : undefined);
        },
        setSeason: (id, n) => {
          const it = get().items.find((x) => x.id === id);
          if (!it || !hasSeasons(it.type)) return;
          const next = { ...it, se: Math.max(1, Math.floor(n)) };
          upd(id, () => next);
          send(id, () => api.updateItem(id, next));
        },
        setVolume: (id, n) => {
          const it = get().items.find((x) => x.id === id);
          if (!it || !isReading(it.type)) return;
          const vol = Math.max(0, Math.floor(n));
          const next = { ...it, vol: vol > 0 ? vol : undefined };
          upd(id, () => next);
          send(id, () => api.updateItem(id, next));
        },
        setRate: (id, n) => {
          const it = get().items.find((x) => x.id === id);
          if (!it) return;
          const rate = it.rate === n ? 0 : n;
          upd(id, (x) => ({ ...x, rate }));
          send(id, () => api.patchItem(id, { rating: rate > 0 ? rate : null }));
        },
        setNote: (id, text) => {
          const note = text.trim();
          upd(id, (x) => ({ ...x, note: note || undefined }));
          get().say(tr(note ? "Заметка сохранена" : "Заметка удалена"));
          send(id, () => api.patchItem(id, { comment: note || null }));
        },

        saveTitle: async (e) => {
          if (!e.t.trim()) {
            get().say(tr("Укажите название"));
            return null;
          }
          // tot = 0 — общее число неизвестно (идущий сериал), прогресс тогда не ограничивается сверху
          const tot = e.type === "movie" ? 1 : num(e.tot, 0);
          const ep = tot > 0 ? Math.min(num(e.ep, 0), tot) : num(e.ep, 0);
          const vol = isReading(e.type) ? num(e.vol, 0) : 0;
          const base = {
            type: e.type,
            t: e.t.trim(),
            en: e.en.trim(),
            desc: e.desc.trim(),
            rate: e.rate || 0,
            se: hasSeasons(e.type) ? Math.max(1, num(e.se, 1)) : 1,
            ep,
            tot,
            vol: vol > 0 ? vol : undefined,
            author: e.author.trim() || undefined,
            tr: e.tr.trim() || undefined,
            link: e.link.trim() || undefined,
            y: num(e.y, new Date().getFullYear()),
            c: e.c.trim() || "—",
            g: e.g.length ? e.g : [tr("Без жанра")],
          };
          const existing = e.id !== null ? get().items.find((x) => x.id === e.id) : undefined;

          try {
            let saved: Title;
            if (existing) {
              // после правок в очереди форма сохраняется поверх них, а не раньше
              saved = await enqueue(existing.id, () => {
                const cur = get().items.find((x) => x.id === existing.id) ?? existing;
                return api.updateItem(existing.id, { ...cur, ...base, st: fixSt(cur.st, ep, tot) });
              });
            } else {
              saved = await api.createItem({ ...base, st: ep > 0 ? "watching" : "planned" });
            }
            try {
              saved = await syncPoster(saved, e.img, existing?.img);
            } catch (err) {
              get().say(err instanceof ApiError ? err.message : tr("Тайтл сохранён, но постер не загрузился"));
            }
            const final = saved;
            set((s) => ({
              lastId: final.id,
              items: s.items.some((x) => x.id === final.id) ? s.items.map((x) => (x.id === final.id ? final : x)) : [final, ...s.items],
            }));
            if (existing?.type === "movie" || final.type === "movie") void reloadLog();
            get().say(tr(existing ? "Сохранено" : "Тайтл добавлен"));
            return final.id;
          } catch (err) {
            fail(err);
            return null;
          }
        },
        deleteTitle: (id) => {
          const it = get().items.find((x) => x.id === id);
          set((s) => ({ items: s.items.filter((x) => x.id !== id), lastId: s.lastId === id ? null : s.lastId }));
          get().say(tr("Тайтл удалён"));
          void enqueue(id, async () => {
            try {
              await api.deleteItem(id);
            } catch (e) {
              // 404 — тайтл уже удалён на сервере, это не ошибка
              if (e instanceof ApiError && e.status === 404) return;
              fail(e);
              if (it) setItems((items) => (items.some((x) => x.id === id) ? items : [it, ...items]));
              await resync(id);
              return;
            }
            await reloadLog();
          });
        },
        addFromCatalog: async (c, st) => {
          const name = get().lang === "en" ? c.en : c.t;
          try {
            const saved = await api.createItem({ type: c.type, st, desc: "", rate: 0, en: c.en, t: c.t, g: c.g, c: c.c, y: c.y, ep: 0, tot: c.tot, se: 1 });
            set((s) => ({ lastId: saved.id, items: [saved, ...s.items] }));
            get().say(tr("Добавлено: ") + name);
          } catch (e) {
            fail(e);
          }
        },
        /** Тайтл из живого поиска: сервер сам создаёт запись и скачивает постер. true — добавлено */
        addFromSearch: async (r, st) => {
          const name = get().lang === "en" && r.en ? r.en : r.t;
          try {
            const saved = await api.addFromCatalog(r, st);
            set((s) => ({ lastId: saved.id, items: [saved, ...s.items.filter((x) => x.id !== saved.id)] }));
            get().say(tr("Добавлено: ") + name);
            return true;
          } catch (e) {
            fail(e); // 409 «Уже в библиотеке» тоже приходит сюда с понятным текстом
            return false;
          }
        },
        enrichCandidates: async (id, source) => {
          try {
            return await api.listCandidates(id, source);
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) fail(e);
            throw e;
          }
        },
        enrichApply: async (id, c, replacePoster) => {
          try {
            // в очереди тайтла: ответ сервера не обгонит более ранние правки (+1, статус)
            const { changed } = await enqueue(id, async () => {
              const r = await api.applyCandidate(id, c.source, c.extId, replacePoster);
              if (isLastInQueue(id)) replaceItem(r.item);
              return r;
            });
            return changed;
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) fail(e);
            throw e;
          }
        },
        /** Загружает записи из файла копии на сервер; уже существующие (то же название и тип) пропускает */
        restore: async (data) => {
          const parsed = parseBackup(fromServerExport(data)); // принимает и копию интерфейса, и JSON-экспорт сервера
          if (!parsed) {
            get().say(tr("Файл не подошёл"));
            return false;
          }
          let added = 0;
          let skipped = 0;
          let failed = 0;
          for (const raw of parsed.items) {
            const known = get().items.some((x) => x.t === raw.t && x.type === raw.type);
            if (known) {
              skipped++;
              continue;
            }
            if (!(raw.type in CATEGORY_TO_API)) {
              failed++;
              continue;
            }
            try {
              const { id: _id, h: _h, ...rest } = raw;
              const saved = await api.createItem(rest);
              set((s) => ({ items: [saved, ...s.items] }));
              added++;
            } catch (e) {
              if (e instanceof ApiError && e.status === 401) {
                fail(e);
                return false;
              }
              failed++;
            }
          }
          if (added) await reloadLog();
          const parts = [`${tr("Загружено: ")}${added}`];
          if (skipped) parts.push(`${tr("уже были: ")}${skipped}`);
          if (failed) parts.push(`${tr("с ошибкой: ")}${failed}`);
          get().say(parts.join(", "));
          return failed === 0;
        },
        markBackup: () => set({ savedAt: Date.now() }),
      };
    },
    {
      name: "episodio-store",
      version: 3,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // Библиотека и лента живут на сервере. Из старых версий (демо-данные с локальными id) берём только время копии
      migrate: (persisted) => ({ lastId: null, savedAt: (persisted as { savedAt?: number } | null)?.savedAt ?? 0 }) as never,
      partialize: (s) => ({ lastId: s.lastId, savedAt: s.savedAt }),
    },
  ),
);

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector("meta[name=theme-color]")?.setAttribute("content", t === "light" ? "#F8FAFC" : "#0F172A");
  try { localStorage.setItem("episodio-theme", t); } catch { /* приватный режим */ }
}

let booting: Promise<void> | null = null;

/** Подгружает настройки (тема, язык) и данные с сервера; вызывается один раз на клиенте */
export function hydrateStore(): Promise<void> {
  booting ??= (async () => {
    await useStore.persist.rehydrate();
    let theme: Theme = "dark";
    let lang: Lang = "ru";
    try {
      theme = localStorage.getItem("episodio-theme") === "light" ? "light" : "dark";
      lang = localStorage.getItem("episodio-lang") === "en" ? "en" : "ru";
    } catch { /* приватный режим */ }
    document.documentElement.setAttribute("lang", lang);
    useStore.setState({ theme, lang });
    // На странице входа и на публичных витринах сессии нет: библиотеку там не грузим (загрузка вернула бы 401 и перевод на вход)
    const path = window.location.pathname;
    if (path !== "/login" && !isPublicPath(path)) useStore.getState().ensureLoaded();
  })();
  return booting;
}
