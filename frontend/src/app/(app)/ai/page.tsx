"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { CATALOG } from "@/lib/catalog-data";
import { type EpiAction, epiReply } from "@/lib/epi";
import { useLang, useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";

interface Msg {
  r: "u" | "a";
  t: string;
  acts?: EpiAction[];
}

const CHIPS = ["Что вышло нового?", "Что можно досмотреть?", "Посоветуй что-нибудь", "Рецензия: серия топ, но концовка слита"];

export default function AiPage() {
  const t = useT();
  const lang = useLang();
  const { addFromCatalog, mark } = useStore();
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, typing]);

  const send = (txt?: string) => {
    const text = (txt ?? input).trim();
    if (!text || typing) return;
    setChat((c) => [...c, { r: "u", t: text }]);
    setInput("");
    setTyping(true);
    // Задержка имитирует «обдумывание»; в продакшене здесь запрос к LLM с контекстом библиотеки
    timer.current = setTimeout(() => {
      const rep = epiReply(text, useStore.getState().items, lang, t);
      setChat((c) => [...c, { r: "a", ...rep }]);
      setTyping(false);
    }, 900);
  };

  const run = (a: EpiAction) => {
    if (a.kind === "mark") mark(a.id);
    else {
      const c = CATALOG.find((x) => x.id === a.catId);
      if (c) addFromCatalog(c, "planned");
    }
  };

  const msgs: Msg[] = [
    { r: "a", t: t("Привет! Я Эпи, ваш компаньон в Episodio. Подскажу, что вышло, что осталось досмотреть, и найду, что взять дальше. С чего начнём?") },
    ...chat,
  ];

  return (
    <>
      <PageHeader kicker={t("AI-компаньон")} title={t("Эпи")} />
      <div className="mx-auto flex h-[max(460px,calc(100dvh-300px))] w-full max-w-[820px] flex-col overflow-hidden rounded-[26px] border border-line bg-glass shadow-card">
        <div className="flex items-center gap-3 border-b border-line px-[18px] py-3.5">
          <div className="flex size-[42px] items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--acc),var(--acc2))] font-display text-xl font-bold text-onacc shadow-[0_0_18px_color-mix(in_srgb,var(--acc)_50%,transparent)]">
            {t("Э")}
          </div>
          <div>
            <div className="font-display text-[17px] font-semibold">{t("Эпи")}</div>
            <div className="text-xs text-muted">{typing ? t("печатает…") : t("Ваш компаньон в Episodio")}</div>
          </div>
        </div>

        <div ref={boxRef} role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">
          {msgs.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, scale: 0.9, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }} className={`flex flex-col gap-2 ${m.r === "u" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[min(580px,88%)] border px-4 py-3 text-[15px] leading-[1.55] whitespace-pre-wrap text-pretty ${
                  m.r === "u" ? "rounded-[18px_18px_6px_18px] border-acc bg-acc text-onacc" : "rounded-[18px_18px_18px_6px] border-line bg-card text-fg"
                }`}
              >
                {m.t}
              </div>
              {m.acts && m.acts.length > 0 && (
                <div className="flex max-w-[min(580px,94%)] flex-wrap gap-2">
                  {m.acts.map((a) => (
                    <button key={a.label} type="button" onClick={() => run(a)} className="flex min-h-10 items-center rounded-full border border-acc px-3.5 font-display text-[13px] font-semibold text-acc hover:bg-acc/15">
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
          <AnimatePresence>
            {typing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-[5px] self-start rounded-[18px_18px_18px_6px] border border-line bg-card px-4 py-3.5" aria-label={t("печатает…")}>
                {[0, 0.18, 0.36].map((d) => (
                  <span key={d} className="size-[7px] rounded-full bg-acc" style={{ animation: `bl 1.1s ${d}s infinite` }} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line px-3.5 pt-3 pb-3.5">
          <div className="flex gap-2 overflow-x-auto">
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => send(t(c))} className="flex h-10 flex-none items-center rounded-full border border-slate-400/30 px-3.5 text-[13px] font-medium text-fg2 hover:border-acc hover:text-acc">
                {t(c)}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("Напишите Эпи…")}
              aria-label={t("Напишите Эпи…")}
              className="h-12 min-w-0 flex-1 rounded-[14px] border border-slate-400/25 bg-bg px-4 text-base outline-none focus:border-acc"
            />
            <button type="submit" className="flex h-12 items-center rounded-[14px] bg-acc px-[22px] font-display text-[15px] font-semibold text-onacc hover:shadow-[0_0_22px_color-mix(in_srgb,var(--acc)_55%,transparent)]">
              {t("Отправить")}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
