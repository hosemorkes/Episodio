"use client";

import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { GAP_LABELS, gapsOf, needsReview } from "@/lib/enrich";
import { useLang, useT } from "@/lib/i18n";
import { displayName, initials, posterBg, typeName } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { TitleType } from "@/lib/types";
import { EnrichModal } from "./EnrichModal";
import { GhostButton } from "./ui";

/** Сколько карточек показываем за раз: в библиотеке без постеров их сотни */
const PAGE = 30;

/** Записи, которым не хватает постера, жанров, страны или года, с быстрым переходом к ручному обогащению */
export function ReviewList({ type }: { type: "all" | TitleType }) {
  const t = useT();
  const lang = useLang();
  const items = useStore((s) => s.items);
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);

  const list = items.filter((x) => needsReview(x) && (type === "all" || x.type === type));

  if (!list.length) {
    return <div className="py-10 text-center text-[15px] text-muted">{t("Всё заполнено: проверять нечего")}</div>;
  }

  return (
    <>
      <p className="text-[13px] text-muted">
        {t("Требуют проверки: ")}
        {list.length}. {t("Нет постера, жанров, страны или года: данные можно подтянуть из внешнего источника.")}
      </p>
      <ul className="flex flex-col gap-2.5">
        {list.slice(0, shown).map((it) => (
          <li key={it.id} className="flex items-center gap-3.5 rounded-2xl border border-line bg-glass p-3">
            <div style={{ background: posterBg(it.img, it.h) }} className="flex h-[72px] w-[50px] flex-none items-end rounded-[10px] p-1 font-display text-sm font-bold text-white/60">
              {!it.img && initials(it.t)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Link href={`/title/${it.id}`} className="truncate font-display text-[15px] font-semibold text-fg no-underline hover:text-acc">
                {displayName(it, lang)}
              </Link>
              <div className="text-xs text-muted">{typeName(it.type, t)}</div>
              <div className="flex flex-wrap gap-1.5">
                {gapsOf(it).map((g) => (
                  <span key={g} className="rounded-full bg-slate-400/15 px-2.5 py-[3px] text-xs">
                    {t(GAP_LABELS[g])}
                  </span>
                ))}
              </div>
            </div>
            <GhostButton onClick={() => setOpen(it.id)} className="flex-none">
              {t("Найти данные")}
            </GhostButton>
          </li>
        ))}
      </ul>
      {list.length > shown && (
        <GhostButton onClick={() => setShown((n) => n + PAGE)} className="self-center">
          {t("Показать ещё")}
        </GhostButton>
      )}
      <AnimatePresence>{open !== null && <EnrichModal id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </>
  );
}
