"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Pill, PrimaryButton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { MONTHS_FULL, MONTHS_SHORT, randomPeriod, SHOW_CATS, SHOW_GENITIVE, SHOW_YEARS, type ShowCat, topFor } from "@/lib/showcase";
import { useStore } from "@/lib/store";
import { useMe } from "@/lib/useMe";

export default function ShowcasePage() {
  const t = useT();
  const say = useStore((s) => s.say);
  const login = useMe() ?? "alex";
  const [cat, setCat] = useState<ShowCat>("anime");
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(0);

  const ci = SHOW_CATS.findIndex(([k]) => k === cat);
  const top = topFor(cat, year, month);
  const slug = `top-${cat}-${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`;
  const title = `${t("Мой топ ")}${t(SHOW_GENITIVE[ci])} ${year}${month ? `, ${t(MONTHS_FULL[month - 1])}` : ""}`;

  const copy = () => {
    try { navigator.clipboard.writeText(`https://episodio.app/u/${login}/${slug}`); } catch { /* буфер недоступен */ }
    say(t("Ссылка скопирована"));
  };

  return (
    <>
      <PageHeader kicker={t("Публичная страница")} title={t("Витрина")} />
      <div className="flex flex-col gap-[18px] rounded-[28px] border border-acc/30 bg-card bg-[radial-gradient(600px_300px_at_20%_0%,color-mix(in_srgb,var(--acc)_22%,transparent),transparent)] p-[22px] min-[560px]:p-9">
        <div className="font-display text-xs font-semibold tracking-[.12em] break-all text-acc">{`EPISODIO.APP/U/${login}/${slug}`.toUpperCase()}</div>
        <div className="font-display text-[26px] font-bold tracking-[-.03em] min-[560px]:text-[34px]">{title}</div>

        <div className="flex flex-col gap-2.5">
          <div className="flex gap-2 overflow-auto">
            {SHOW_CATS.map(([k, n]) => (
              <Pill key={k} on={cat === k} onClick={() => setCat(k)}>
                {t(n)[0].toUpperCase() + t(n).slice(1)}
              </Pill>
            ))}
          </div>
          <div className="flex gap-2 overflow-auto">
            {SHOW_YEARS.map((y) => (
              <Pill key={y} on={year === y} onClick={() => setYear(y)}>
                {y}
              </Pill>
            ))}
          </div>
          <div className="flex gap-2 overflow-auto">
            <Pill on={!month} onClick={() => setMonth(0)}>
              {t("Весь год")}
            </Pill>
            {MONTHS_SHORT.map((m, i) => (
              <Pill key={m} on={month === i + 1} onClick={() => setMonth(i + 1)}>
                {t(m)}
              </Pill>
            ))}
            <button
              type="button"
              onClick={() => { const p = randomPeriod(); setCat(p.cat); setYear(p.year); setMonth(p.month); }}
              className="flex h-10 flex-none items-center rounded-full border border-dashed border-acc2/50 px-3.5 font-display text-[13px] font-semibold text-acc2 hover:bg-acc2/12"
            >
              {t("Случайный период")}
            </button>
          </div>
        </div>

        {!top.length && <div className="py-9 text-center text-sm text-muted">{t("Нет записей за этот период")}</div>}
        <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-4">
          <AnimatePresence mode="popLayout">
            {top.map((s, i) => (
              <motion.div
                key={`${cat}-${year}-${month}-${s.t}`}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.05 }}
                style={{ background: `linear-gradient(160deg,hsl(${s.h},55%,38%),hsl(${(s.h + 40) % 360},60%,22%))` }}
                className="flex aspect-[3/4] flex-col justify-between rounded-2xl p-3"
              >
                <span className="font-display text-2xl font-bold text-white/45">#{i + 1}</span>
                <div>
                  <div className="font-display text-sm font-semibold text-slate-100">{s.t}</div>
                  <div className="mt-0.5 text-xs text-slate-300">{s.r.toFixed(1)} / 10</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <PrimaryButton onClick={copy} className="self-start">
          {t("Поделиться")}
        </PrimaryButton>
      </div>
    </>
  );
}
