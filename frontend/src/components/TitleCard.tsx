"use client";

import { motion, type PanInfo } from "framer-motion";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useT, useLang } from "@/lib/i18n";
import { altName, displayName, initials, metaOf, pct, posterBg, typeName, unitOf } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { Title } from "@/lib/types";

/** Карточка тайтла: «+» отмечает серию, свайп вправо — отметить, влево — детали */
export function TitleCard({ it }: { it: Title }) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const mark = useStore((s) => s.mark);
  const pulsing = useStore((s) => s.pulse === it.id);
  const dragged = useRef(false);
  const u = unitOf(it.type, t);

  const openNewWindow = () => window.open(`/title/${it.id}`, "_blank", "noopener");
  const open = (e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (dragged.current) return;
    // Ctrl/Cmd/Shift + клик — как у обычной ссылки: в новой вкладке или окне
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) openNewWindow();
    else router.push(`/title/${it.id}`);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { x, y } = info.offset;
    if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y)) {
      if (x > 0) mark(it.id);
      else router.push(`/title/${it.id}`);
    }
    setTimeout(() => (dragged.current = false), 60);
  };

  return (
    <motion.div
      role="link"
      tabIndex={0}
      aria-label={displayName(it, lang)}
      onClick={open}
      onMouseDown={(e) => {
        // Средняя кнопка (колесо): в новую вкладку; preventDefault гасит автопрокрутку браузера
        if (e.button === 1) {
          e.preventDefault();
          openNewWindow();
        }
      }}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      onKeyDown={(e) => e.key === "Enter" && open(e)}
      drag="x"
      dragSnapToOrigin
      dragElastic={0.25}
      dragConstraints={{ left: 0, right: 0 }}
      onDragStart={() => (dragged.current = true)}
      onDragEnd={onDragEnd}
      whileHover={{ scale: 1.03, boxShadow: "0 18px 40px rgba(0,0,0,.5), 0 0 0 1px rgba(45,212,191,.4)" }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      style={{ background: posterBg(it.img, it.h), touchAction: "pan-y" }}
      className="relative aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-[20px] border border-slate-400/15 select-none"
    >
      <div className="absolute top-2.5 left-2.5 flex h-7 items-center rounded-full bg-[rgba(15,23,42,.55)] px-2.5 font-display text-[13px] font-semibold text-[#2DD4BF] backdrop-blur-[8px]">
        ★ {it.rate || "—"} · {typeName(it.type, t)}
      </div>
      {!it.img && <div className="absolute top-12 left-3.5 font-display text-[32px] font-bold text-white/35">{initials(it.t)}</div>}
      <button
        type="button"
        aria-label={t("Редактировать")}
        onClick={(e) => { e.stopPropagation(); router.push(`/title/${it.id}/edit`); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-full bg-[rgba(15,23,42,.45)] font-display text-lg font-semibold text-slate-200 backdrop-blur-[8px] transition-colors hover:bg-[rgba(45,212,191,.35)]"
      >
        ✎
      </button>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 bg-[linear-gradient(transparent,rgba(15,23,42,.92)_40%)] p-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-semibold text-slate-100">{displayName(it, lang)}</div>
          <div className="truncate text-xs text-slate-300">{altName(it, lang)}</div>
          <div className="mt-0.5 mb-2 text-xs text-slate-400">{metaOf(it, t)}</div>
          <div className="h-1 rounded-sm bg-slate-400/25">
            <div className="h-full rounded-sm bg-[#2DD4BF] transition-[width] duration-[400ms]" style={{ width: `${pct(it.ep, it.tot)}%` }} />
          </div>
        </div>
        <motion.button
          type="button"
          aria-label={u.mark.trim()}
          onClick={(e) => { e.stopPropagation(); mark(it.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          animate={{ scale: pulsing ? 1.25 : 1, boxShadow: pulsing ? "0 0 28px #2DD4BF" : "0 0 0 #2DD4BF" }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 520, damping: 14 }}
          className="flex size-11 flex-none items-center justify-center rounded-full bg-[#2DD4BF] font-display text-2xl font-semibold text-[#04201C]"
        >
          +
        </motion.button>
      </div>
    </motion.div>
  );
}
