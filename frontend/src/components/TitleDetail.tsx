"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import { altName, displayName, hasSeasons, initials, isReading, pct, posterBg, STATUSES, statusLabel, typeName, unitOf } from "@/lib/rules";
import { useStore } from "@/lib/store";
import { EnrichModal } from "./EnrichModal";
import { GhostButton, Pill, PrimaryButton, Skeleton } from "./ui";

const card = "flex flex-col gap-3.5 rounded-[22px] border border-line bg-glass p-5 shadow-card backdrop-blur-[14px]";

export function TitleDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const { items, hydrated, pulse, mark, minus, setStatus, setRate } = useStore();
  const it = items.find((x) => x.id === Number(id));
  const [enrichOpen, setEnrichOpen] = useState(false);

  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-[880px] flex-col gap-5 px-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(40px+env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );

  if (!hydrated) {
    return shell(
      <>
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-[293px] w-[220px]" />
        <Skeleton className="h-32" />
      </>,
    );
  }
  if (!it) {
    return shell(
      <>
        <button type="button" onClick={back} className="flex h-11 w-fit items-center rounded-[14px] border border-slate-400/20 bg-glass px-[18px] font-display text-sm font-semibold hover:border-acc">
          {t("← Назад")}
        </button>
        <div className="py-16 text-center text-muted">{t("Тайтл не найден")}</div>
      </>,
    );
  }

  const u = unitOf(it.type, t);
  const done = it.tot > 0 && it.ep >= it.tot;
  const sub = done ? u.done : it.type === "movie" ? u.left : it.tot > 0 ? u.left + (it.tot - it.ep) : "";
  const chips = [
    typeName(it.type, t),
    String(it.y),
    t(it.c),
    ...(hasSeasons(it.type) ? [t("Сезон ") + (it.se ?? 1)] : []),
    ...(isReading(it.type) && it.vol ? [t("Том ") + it.vol] : []),
    ...it.g.map(t),
  ];
  const facts: [string, string][] = [
    [t("Автор"), it.author ?? ""],
    [t("Озвучка / перевод"), it.tr ?? ""],
  ];
  const pulsing = pulse === it.id;

  return shell(
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={back} className="flex h-11 items-center rounded-[14px] border border-slate-400/20 bg-glass px-[18px] font-display text-sm font-semibold transition-colors hover:border-acc">
          {t("← Назад")}
        </button>
        <div className="flex gap-2">
          <GhostButton onClick={() => setEnrichOpen(true)}>{t("Найти данные")}</GhostButton>
          <Link href={`/title/${it.id}/edit`} aria-label={t("Редактировать")} className="flex h-11 items-center rounded-[14px] border border-slate-400/25 px-[18px] font-display text-sm font-semibold text-fg no-underline transition-colors hover:border-acc hover:text-fg">
            {t("✎ Редактировать")}
          </Link>
        </div>
      </div>
      <AnimatePresence>{enrichOpen && <EnrichModal id={it.id} onClose={() => setEnrichOpen(false)} />}</AnimatePresence>

      <div className="flex flex-wrap items-start gap-6">
        <div
          style={{ background: posterBg(it.img, it.h) }}
          className="flex aspect-[3/4] w-[min(220px,100%)] flex-none items-end rounded-[20px] p-3.5 font-display text-[40px] font-bold text-white/50 shadow-[0_20px_50px_rgba(0,0,0,.45)]"
        >
          {!it.img && initials(it.t)}
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3.5">
          <div>
            <h2 className="font-display text-[30px] font-bold tracking-[-.03em]">{displayName(it, lang)}</h2>
            <div className="mt-1 text-[15px] text-fg2">{altName(it, lang)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <span key={c + i} className="rounded-full bg-slate-400/15 px-3 py-[5px] text-xs">
                {c}
              </span>
            ))}
          </div>
          <p className="text-[15px] leading-[1.6] text-fg2 text-pretty">{it.desc || t("Описание не добавлено. Его можно написать в режиме редактирования.")}</p>
          {facts.some(([, v]) => v) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {it.link && /^https?:\/\//i.test(it.link) && (
            <a href={it.link} target="_blank" rel="noopener noreferrer" className="w-fit text-[14px] text-acc">
              {t("Открыть источник")} ↗
            </a>
          )}
        </div>
      </div>

      <section className={card}>
        <div className="kicker">{t("СТАТУС")}</div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map(([k, n]) => (
            <Pill key={k} h={44} on={it.st === k} onClick={() => setStatus(it.id, k)} className="font-medium">
              {statusLabel(k, it.type, t, t(n))}
            </Pill>
          ))}
        </div>
      </section>

      <section className={card}>
        <div className="kicker">{t("ВАШ ПРОГРЕСС")}</div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => minus(it.id)} aria-label={t("Минус серия")} className="flex size-12 items-center justify-center rounded-full border border-slate-400/30 font-display text-2xl font-semibold hover:border-acc">
            −
          </button>
          <div className="min-w-[120px] text-center font-display text-[44px] leading-none font-bold tracking-[-.04em]">
            {it.ep}
            {it.tot > 0 && <span className="text-xl text-muted"> / {it.tot}</span>}
          </div>
          <motion.button
            type="button"
            onClick={() => mark(it.id)}
            aria-label={t("Плюс серия")}
            animate={{ scale: pulsing ? 1.2 : 1, boxShadow: pulsing ? "0 0 28px var(--acc)" : "0 0 0 var(--acc)" }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 520, damping: 14 }}
            className="flex size-12 items-center justify-center rounded-full bg-acc font-display text-[26px] font-semibold text-onacc"
          >
            +
          </motion.button>
          <div className="text-[13px] text-muted">{sub}</div>
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-400/20">
          <div className="h-full bg-acc shadow-[0_0_12px_var(--acc)] transition-[width] duration-[400ms]" style={{ width: `${pct(it.ep, it.tot)}%` }} />
        </div>
      </section>

      <section className={card}>
        <div className="kicker">
          {t("ВАША ОЦЕНКА · ")}
          {it.rate ? it.rate + t(" из 10") : t("не выставлена")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={it.rate === n}
              onClick={() => setRate(it.id, n)}
              className={`flex size-11 items-center justify-center rounded-xl border font-display text-[15px] font-semibold transition-colors hover:border-acc ${it.rate === n ? "border-acc bg-acc text-onacc" : "border-slate-400/20 bg-bg text-fg"}`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className={card}>
        <div className="kicker">{t("ЗАМЕТКА")}</div>
        <NoteEditor key={`${it.id}:${it.note ?? ""}`} id={it.id} note={it.note ?? ""} />
      </section>
    </motion.div>,
  );
}

/** Личная заметка или рецензия: одна на тайтл, пустой текст удаляет её */
function NoteEditor({ id, note }: { id: number; note: string }) {
  const t = useT();
  const setNote = useStore((s) => s.setNote);
  const [text, setText] = useState(note);
  const changed = text.trim() !== note.trim();

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) setNote(id, text);
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={t("Ваши впечатления, рецензия или заметка")}
        aria-label={t("Заметка")}
        className="w-full resize-y rounded-xl border border-slate-400/20 bg-bg px-3.5 py-3 text-[15px] leading-normal font-medium outline-none focus:border-acc"
      />
      <PrimaryButton type="submit" disabled={!changed} className="self-start disabled:opacity-50">
        {t("Сохранить заметку")}
      </PrimaryButton>
    </form>
  );
}
