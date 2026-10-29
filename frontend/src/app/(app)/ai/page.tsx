"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { type AiConversation, api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Msg {
  r: "u" | "a";
  t: string;
  /** ответ не получен: показываем как ошибку */
  err?: boolean;
}

/** Подсказки пустого диалога: подпись и текст, который уходит Эпи */
const CHIPS = ["Что посмотреть под чак-чак?", "Новости релизов аниме", "Анализ моих вкусов"];

/** Что делает Эпи, пока вызывает инструмент (строки — ключи словаря) */
const TOOL_LABELS: Record<string, string> = {
  search_library: "Смотрю вашу библиотеку…",
  get_user_stats: "Анализирую ваши вкусы…",
  search_internet_tavily: "Ищу в интернете…",
  get_catalog_popular: "Смотрю, что сейчас популярно…",
};

export default function AiPage() {
  const t = useT();
  const [chats, setChats] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollDown = useCallback(() => {
    const box = boxRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight });
  }, []);

  // Автоскролл вниз при новых репликах, кусках ответа и появлении спиннера инструмента
  useEffect(scrollDown, [chat, tool, scrollDown]);

  const open = useCallback(async (id: number) => {
    abortRef.current?.abort();
    setBusy(false);
    setTool(null);
    setActiveId(id);
    setMenu(false);
    try {
      const list = await api.listAiMessages(id);
      setChat(list.map((m) => ({ r: m.role === "user" ? "u" : "a", t: m.content })));
    } catch (e) {
      setChat([{ r: "a", t: e instanceof ApiError ? e.message : t("Не удалось загрузить диалог"), err: true }]);
    }
  }, [t]);

  // При входе открываем последний диалог (список приходит свежими первыми)
  useEffect(() => {
    let alive = true;
    api
      .listConversations()
      .then((list) => {
        if (!alive) return;
        setChats(list);
        if (list.length) void open(list[0].id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const newChat = () => {
    abortRef.current?.abort();
    setBusy(false);
    setTool(null);
    setActiveId(null);
    setChat([]);
    setMenu(false);
  };

  const send = async (txt?: string) => {
    const text = (txt ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setChat((c) => [...c, { r: "u", t: text }, { r: "a", t: "" }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Диалог создаётся при первой реплике: пустых чатов в списке не копится
      let id = activeId;
      if (id === null) {
        const created = await api.createConversation();
        id = created.id;
        setActiveId(id);
        setChats((l) => [created, ...l]);
      }
      await api.streamAiMessage(
        id,
        text,
        {
          onChunk: (piece) => {
            setTool(null);
            setChat((c) => c.map((m, i) => (i === c.length - 1 ? { ...m, t: m.t + piece } : m)));
          },
          onTool: setTool,
        },
        ctrl.signal,
      );
      // Название диалога появилось на сервере из первой реплики
      api.listConversations().then(setChats).catch(() => undefined);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      const msg = e instanceof ApiError ? e.message : t("Что-то пошло не так");
      // Уже набранный кусок ответа оставляем, ошибку добавляем отдельной репликой
      setChat((c) => {
        const last = c[c.length - 1];
        const rest = last && last.r === "a" && !last.t ? c.slice(0, -1) : c;
        return [...rest, { r: "a", t: msg, err: true }];
      });
    } finally {
      if (abortRef.current === ctrl) {
        setBusy(false);
        setTool(null);
      }
    }
  };

  const empty = chat.length === 0;
  const waiting = busy && !tool && chat[chat.length - 1]?.t === "";
  const title = chats.find((c) => c.id === activeId)?.title;

  return (
    <>
      <PageHeader kicker={t("AI-компаньон")} title={t("Эпи")} />
      <div className="relative mx-auto flex h-[max(460px,calc(100dvh-300px))] w-full max-w-[820px] flex-col overflow-hidden rounded-[26px] border border-line bg-glass shadow-card">
        <div className="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
          <div className="flex size-[42px] flex-none items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--acc),var(--acc2))] font-display text-xl font-bold text-onacc shadow-[0_0_18px_color-mix(in_srgb,var(--acc)_50%,transparent)]">
            {t("Э")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[17px] font-semibold">{t("Эпи")}</div>
            <div className="truncate text-xs text-muted">{busy ? (tool ? t(TOOL_LABELS[tool] ?? "Работаю…") : t("печатает…")) : title || t("Ваш компаньон в Episodio")}</div>
          </div>
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            className="flex h-10 flex-none items-center rounded-full border border-slate-400/30 px-3.5 text-[13px] font-medium text-fg2 hover:border-acc hover:text-acc"
          >
            {t("Диалоги")}
          </button>
          <button
            type="button"
            onClick={newChat}
            className="flex h-10 flex-none items-center rounded-full border border-acc px-3.5 font-display text-[13px] font-semibold text-acc hover:bg-acc/15"
          >
            {t("Новый чат")}
          </button>
        </div>

        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-x-3 top-[72px] z-10 flex max-h-[min(320px,60%)] flex-col gap-1 overflow-y-auto rounded-[18px] border border-line bg-pop p-2 shadow-card backdrop-blur"
            >
              {chats.length === 0 && <div className="px-3 py-2.5 text-sm text-muted">{t("Пока нет диалогов")}</div>}
              {chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void open(c.id)}
                  className={`flex min-h-11 items-center rounded-[12px] px-3 text-left text-sm hover:bg-acc/10 ${c.id === activeId ? "bg-acc/15 font-semibold text-acc" : "text-fg"}`}
                >
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={boxRef} role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
          {empty && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-3">
              <div className="max-w-[min(580px,88%)] rounded-[18px_18px_18px_6px] border border-line bg-card px-4 py-3 text-[15px] leading-[1.55] text-fg">
                {t("Привет! Я Эпи, ваш компаньон в Episodio. Подскажу, что посмотреть или почитать, расскажу про новинки и разберу ваши вкусы. С чего начнём?")}
              </div>
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <button key={c} type="button" onClick={() => void send(t(c))} className="flex min-h-10 items-center rounded-full border border-acc px-3.5 font-display text-[13px] font-semibold text-acc hover:bg-acc/15">
                    {t(c)}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {chat.map((m, i) =>
            m.r === "a" && m.t === "" ? null : (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.9, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }} className={`flex flex-col gap-2 ${m.r === "u" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[min(580px,88%)] border px-4 py-3 text-[15px] leading-[1.55] whitespace-pre-wrap text-pretty ${
                    m.r === "u" ? "rounded-[18px_18px_6px_18px] border-acc bg-acc text-onacc" : m.err ? "rounded-[18px_18px_18px_6px] border-err/50 bg-card text-err" : "rounded-[18px_18px_18px_6px] border-line bg-card text-fg"
                  }`}
                >
                  {m.t}
                </div>
              </motion.div>
            ),
          )}
          <AnimatePresence>
            {busy && (tool || waiting) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 self-start rounded-[18px_18px_18px_6px] border border-line bg-card px-4 py-3" aria-label={tool ? t(TOOL_LABELS[tool] ?? "Работаю…") : t("печатает…")}>
                {tool ? (
                  <>
                    <span className="size-4 animate-spin-fast rounded-full border-2 border-acc border-t-transparent" />
                    <span className="text-sm text-muted">{t(TOOL_LABELS[tool] ?? "Работаю…")}</span>
                  </>
                ) : (
                  [0, 0.18, 0.36].map((d) => <span key={d} className="size-[7px] rounded-full bg-acc" style={{ animation: `bl 1.1s ${d}s infinite` }} />)
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line px-3.5 pt-3 pb-3.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("Напишите Эпи…")}
              aria-label={t("Напишите Эпи…")}
              maxLength={4000}
              className="h-12 min-w-0 flex-1 rounded-[14px] border border-slate-400/25 bg-bg px-4 text-base outline-none focus:border-acc"
            />
            <button type="submit" disabled={busy || !input.trim()} className="flex h-12 items-center rounded-[14px] bg-acc px-[22px] font-display text-[15px] font-semibold text-onacc hover:shadow-[0_0_22px_color-mix(in_srgb,var(--acc)_55%,transparent)] disabled:opacity-50 disabled:hover:shadow-none">
              {t("Отправить")}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
