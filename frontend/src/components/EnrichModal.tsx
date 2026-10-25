"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { changedText, enrichErrorInfo, sourceName, sourcesFor } from "@/lib/enrich";
import { useLang, useT } from "@/lib/i18n";
import { displayName, posterBg } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { EnrichCandidate } from "@/lib/types";
import { GhostButton, Pill, PrimaryButton, Skeleton, Spinner } from "./ui";

type Failure = { message: string; retry: boolean; reload: boolean; stage: "load" | "apply" };

/** Окно ручного выбора: варианты из внешнего источника для карточки; выбранный заполняет пустые поля */
export function EnrichModal({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const it = useStore((s) => s.items.find((x) => x.id === id));
  const { enrichCandidates, enrichApply, say } = useStore();
  const [list, setList] = useState<EnrichCandidate[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [applying, setApplying] = useState<EnrichCandidate | null>(null);
  const [replacePoster, setReplacePoster] = useState(false);
  // Источник по умолчанию — первый; выбор показывается, только если у типа их несколько (аниме и манга)
  const sources = it ? sourcesFor(it.type) : [];
  const [source, setSource] = useState<string | undefined>(undefined);
  const activeSource = source ?? sources[0];
  const dialogRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const lastTried = useRef<EnrichCandidate | null>(null);

  const load = useCallback(async () => {
    setList(null);
    setFailure(null);
    try {
      const found = await enrichCandidates(id, activeSource);
      if (alive.current) setList(found);
    } catch (e) {
      if (alive.current) setFailure({ ...enrichErrorInfo(e), stage: "load" });
    }
  }, [enrichCandidates, id, activeSource]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !applying && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  const apply = async (c: EnrichCandidate) => {
    setApplying(c);
    setFailure(null);
    try {
      const changed = await enrichApply(id, c, replacePoster);
      say(changedText(changed, t));
      onClose();
    } catch (e) {
      if (alive.current) {
        setApplying(null);
        setFailure({ ...enrichErrorInfo(e), stage: "apply" });
      }
    }
  };

  // Повтор: после сбоя выбора повторяется выбор, а при загрузке списка и при 404 («вариант пропал») обновляется список
  const retry = () => (failure?.stage === "apply" && !failure.reload && lastTried.current ? apply(lastTried.current) : load());

  if (!it) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !applying && onClose()}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(2,6,23,.6)] px-3 py-[8vh] backdrop-blur-[6px]"
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Найти данные")}
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-[22px] border border-acc/35 bg-pop p-5 shadow-[0_30px_80px_rgba(0,0,0,.6)] outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="kicker">{t("НАЙТИ ДАННЫЕ")}</div>
            <h2 className="mt-1 font-display text-xl font-bold tracking-[-.02em] text-balance">{displayName(it, lang)}</h2>
            <p className="mt-1 text-[13px] text-muted">{t("Выберите подходящий вариант: пустые поля карточки (постер, жанры, страна, год, автор) заполнятся, заполненные не изменятся.")}</p>
          </div>
          <GhostButton onClick={onClose} disabled={!!applying} aria-label={t("Закрыть")} className="flex-none px-3.5">
            ✕
          </GhostButton>
        </div>

        {sources.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Источник")}>
            <span className="text-xs text-muted">{t("Источник")}</span>
            {sources.map((s) => (
              <Pill key={s} h={36} on={activeSource === s} disabled={!!applying} onClick={() => setSource(s)}>
                {sourceName(s)}
              </Pill>
            ))}
          </div>
        )}

        {it.img && (
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input type="checkbox" checked={replacePoster} onChange={(e) => setReplacePoster(e.target.checked)} disabled={!!applying} className="size-5 accent-[var(--acc)]" />
            {t("Заменить постер")}
          </label>
        )}

        {failure && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{t(failure.message)}</span>
            {failure.retry && (
              <GhostButton onClick={retry} className="flex-none">
                {t("Повторить")}
              </GhostButton>
            )}
          </div>
        )}

        {list === null && !failure && (
          <div className="flex flex-col gap-2.5" aria-busy="true">
            <div className="text-[13px] text-muted">{t("Ищем варианты…")}</div>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        )}

        {list !== null && !list.length && !failure && <div className="py-6 text-center text-[15px] text-muted">{t("Подходящих вариантов не нашлось")}</div>}

        {list !== null && list.length > 0 && (
          <ul className="flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto">
            {list.map((c) => (
              <li key={c.key} className="flex items-center gap-3.5 rounded-2xl border border-line bg-glass p-3">
                <div style={{ background: posterBg(c.img, [210, 230]) }} className="h-[84px] w-[58px] flex-none rounded-[10px] border border-slate-400/20" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="font-display text-[15px] leading-tight font-semibold">
                    {c.t}
                    {c.y > 0 && <span className="font-normal text-muted"> · {c.y}</span>}
                  </div>
                  {c.en && c.en !== c.t && <div className="text-[13px] text-fg2">{c.en}</div>}
                  <div className="text-xs text-muted">
                    {[sourceName(c.source), c.c !== "—" ? t(c.c) : "", c.author ?? ""].filter(Boolean).join(" · ")}
                  </div>
                  {c.g.length > 0 && <div className="text-xs text-muted">{c.g.map(t).join(", ")}</div>}
                </div>
                <PrimaryButton
                  onClick={() => {
                    lastTried.current = c;
                    void apply(c);
                  }}
                  disabled={!!applying}
                  className="flex-none px-4! disabled:opacity-60"
                >
                  {applying?.key === c.key && <Spinner />}
                  {t("Выбрать")}
                </PrimaryButton>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}
