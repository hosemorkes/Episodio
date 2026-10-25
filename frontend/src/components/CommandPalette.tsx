"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { displayName } from "@/lib/rules";
import { useStore } from "@/lib/store";

interface Result {
  label: string;
  kind: string;
  run: () => void;
}

// Короткие алиасы из прототипа: «JJK», «AoT»
const ALIASES: Record<number, string> = { 1: "aot", 2: "jjk" };

export const SCREENS: [string, string][] = [
  ["/", "Дашборд"],
  ["/catalog", "Каталог"],
  ["/feed", "Лента"],
  ["/stats", "Статистика"],
  ["/ai", "AI-компаньон"],
  ["/showcase", "Витрина"],
  ["/settings", "Настройки"],
];

export function CommandPalette() {
  const open = useStore((s) => s.palOpen);
  const setOpen = useStore((s) => s.setPalOpen);
  const items = useStore((s) => s.items);
  const lang = useStore((s) => s.lang);
  const mark = useStore((s) => s.mark);
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const out: Result[] = [];
    const close = () => setOpen(false);
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const match = (it: (typeof items)[number]) => {
      const initials = it.t.split(" ").map((w) => w[0]).join("");
      const hay = `${it.t} ${it.en ?? ""} ${initials} ${ALIASES[it.id] ?? ""}`.toLowerCase();
      return !query || hay.includes(query);
    };
    items.filter(match).forEach((it) =>
      out.push({ label: t("Отметить серию: ") + displayName(it, lang), kind: t("Действие"), run: () => { mark(it.id); close(); } }),
    );
    SCREENS.forEach(([href, label]) => {
      if (!query || t(label).toLowerCase().includes(query)) out.push({ label: t("Перейти: ") + t(label), kind: t("Навигация"), run: go(href) });
    });
    if (query) out.push({ label: `${t("Добавить тайтл «")}${q.trim()}»`, kind: t("Добавить"), run: go(`/title/new?t=${encodeURIComponent(q.trim())}`) });
    if (query) {
      items.filter(match).forEach((it) => {
        out.push({ label: t("Открыть: ") + displayName(it, lang), kind: t("Детали"), run: go(`/title/${it.id}`) });
        out.push({ label: t("Редактировать: ") + displayName(it, lang), kind: t("Правка"), run: go(`/title/${it.id}/edit`) });
      });
    }
    return out.slice(0, 8);
  }, [q, items, lang, t, mark, router, setOpen]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") results[sel]?.run();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(2,6,23,.6)] px-3 pt-[12vh] backdrop-blur-[6px] min-[560px]:pt-[16vh]"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("Поиск")}
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] overflow-hidden rounded-[22px] border border-acc/35 bg-pop shadow-[0_30px_80px_rgba(0,0,0,.6),0_0_40px_color-mix(in_srgb,var(--acc)_12%,transparent)]"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0); }}
              onKeyDown={onKey}
              placeholder={t("JJK, Атака, Статистика…")}
              aria-label={t("Поиск")}
              className="w-full border-b border-slate-400/15 bg-transparent px-5 py-[18px] font-display text-[17px] font-medium outline-none placeholder:text-faint"
            />
            <div className="flex max-h-[360px] flex-col gap-0.5 overflow-auto p-2">
              {results.map((r, i) => (
                <button
                  key={r.label + i}
                  type="button"
                  onClick={r.run}
                  onMouseEnter={() => setSel(i)}
                  className={`flex min-h-11 items-center justify-between gap-2.5 rounded-xl p-3 text-left text-sm ${i === sel ? "bg-acc/15" : "hover:bg-slate-400/10"}`}
                >
                  <span>{r.label}</span>
                  <span className="text-xs text-faint">{r.kind}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
