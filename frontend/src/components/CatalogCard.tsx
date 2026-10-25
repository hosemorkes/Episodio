"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useLang, useT } from "@/lib/i18n";
import { AIR_LABEL, catalogBg, findMine, initials, statusLabel, typeName } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { CatalogItem, CatalogResult, Title, TitleStatus, TitleType } from "@/lib/types";

/** Мини-меню «Смотрю / В планы» над кнопкой добавления */
function AddMenu({ type, onPick, onClose, className }: { type: TitleType; onPick: (st: TitleStatus) => void; onClose: () => void; className: string }) {
  const t = useT();
  const opts = [
    { label: statusLabel("watching", type, t, ""), st: "watching" as const },
    { label: t("В планы"), st: "planned" as const },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-[6] flex flex-col gap-0.5 rounded-2xl border border-acc/40 bg-pop p-1.5 shadow-[0_14px_30px_rgba(0,0,0,.4)] ${className}`}
    >
      {opts.map((o) => (
        <button
          key={o.st}
          type="button"
          onClick={() => { onPick(o.st); onClose(); }}
          className="flex min-h-11 items-center rounded-[10px] px-3 text-left text-sm font-medium hover:bg-slate-400/15"
        >
          {o.label}
        </button>
      ))}
    </motion.div>
  );
}

export function addButtonProps(mine: Title | undefined, t: (s: string) => string) {
  return mine
    ? { label: t("В библиотеке"), bg: "rgba(2,6,23,.7)", fg: "#E2E8F0" }
    : { label: t("+ Добавить"), bg: "#2DD4BF", fg: "#04201C" };
}

/** Карточка каталога: постер 2:3, бейдж статуса выхода, кнопка добавления */
export function CatalogCard({ c, menuKey, openMenu, setOpenMenu, width }: { c: CatalogItem; menuKey: string; openMenu: string | null; setOpenMenu: (k: string | null) => void; width: string }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const mine = useStore((s) => findMine(s.items, c));
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const btn = addButtonProps(mine, t);
  const open = openMenu === menuKey;
  const act = () => (mine ? router.push(`/title/${mine.id}`) : setOpenMenu(open ? null : menuKey));
  const name = lang === "en" ? c.en : c.t;

  return (
    <div className="flex flex-none flex-col gap-2" style={{ width }}>
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={name}
        onClick={act}
        onKeyDown={(e) => e.key === "Enter" && act()}
        whileHover={{ y: -4, boxShadow: "0 18px 40px rgba(0,0,0,.4), 0 0 0 1px color-mix(in srgb, var(--acc) 50%, transparent)" }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        style={{ background: catalogBg(c.h) }}
        className="relative aspect-[2/3] cursor-pointer overflow-hidden rounded-[18px] shadow-card"
      >
        <div className="absolute top-2.5 left-3 font-display text-[34px] font-bold text-white/35">{initials(name)}</div>
        <span className="absolute top-2.5 right-2.5 rounded-full bg-[rgba(2,6,23,.55)] px-[9px] py-[3px] font-display text-[11px] font-semibold text-slate-100 backdrop-blur-[8px]">
          {t(AIR_LABEL[c.s])}
        </span>
        <AnimatePresence>{open && <AddMenu type={c.type} onPick={(st) => addFromCatalog(c, st)} onClose={() => setOpenMenu(null)} className="right-2 bottom-14 left-2" />}</AnimatePresence>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); act(); }}
          style={{ background: btn.bg, color: btn.fg }}
          className="absolute right-2 bottom-2 left-2 flex h-11 items-center justify-center rounded-[14px] font-display text-sm font-semibold backdrop-blur-[8px] hover:shadow-[0_0_22px_rgba(45,212,191,.5)]"
        >
          {btn.label}
        </button>
      </motion.div>
      <div className="font-display text-[15px] leading-tight font-semibold">{name}</div>
      <div className="text-xs text-muted">
        {c.y} · {c.g.map(t).join(", ")}
      </div>
      <div className="font-display text-[13px] font-semibold">
        <span className="text-star">★</span> {c.r ? c.r.toFixed(1) : "—"}
      </div>
    </div>
  );
}

/** Крупный баннер карусели */
export function HeroBanner({ c, index, menuKey, openMenu, setOpenMenu }: { c: CatalogItem; index: number; menuKey: string; openMenu: string | null; setOpenMenu: (k: string | null) => void }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const mine = useStore((s) => findMine(s.items, c));
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const btn = addButtonProps(mine, t);
  const open = openMenu === menuKey;
  const act = () => (mine ? router.push(`/title/${mine.id}`) : setOpenMenu(open ? null : menuKey));
  const badge = index === 0 ? t("Топ недели") : c.y >= 2023 ? t("Новинка сезона") : t("Популярное");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={act}
      onKeyDown={(e) => e.key === "Enter" && act()}
      style={{ background: `linear-gradient(to top,rgba(2,6,23,.8),rgba(2,6,23,.05) 70%),${catalogBg(c.h)}` }}
      className="relative flex h-60 w-[min(580px,88%)] flex-none cursor-pointer snap-start flex-col justify-end gap-2 overflow-hidden rounded-[26px] p-[22px] text-slate-100 shadow-card"
    >
      <span className="self-start rounded-full bg-[rgba(2,6,23,.55)] px-3 py-1 font-display text-xs font-semibold tracking-[.06em] text-[#2DD4BF] backdrop-blur-[8px]">{badge}</span>
      <div className="font-display text-[28px] font-bold tracking-[-.03em]">{lang === "en" ? c.en : c.t}</div>
      <div className="text-sm text-slate-300">
        {c.y} · {c.g.map(t).join(", ")} · {t(AIR_LABEL[c.s])}
      </div>
      <div className="flex items-center gap-3.5">
        <span className="font-display text-base font-semibold text-amber-400">★ {c.r ? c.r.toFixed(1) : "—"}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); act(); }}
          style={{ background: btn.bg, color: btn.fg }}
          className="flex h-11 items-center rounded-[14px] px-5 font-display text-sm font-semibold hover:shadow-[0_0_22px_rgba(45,212,191,.5)]"
        >
          {btn.label}
        </button>
      </div>
      <AnimatePresence>{open && <AddMenu type={c.type} onPick={(st) => addFromCatalog(c, st)} onClose={() => setOpenMenu(null)} className="bottom-[84px] left-[22px] min-w-[200px]" />}</AnimatePresence>
    </div>
  );
}

/** Крупный баннер живой подборки: внешний постер, оценка источника, добавление в библиотеку */
export function SearchHero({ r, index, menuKey, openMenu, setOpenMenu }: { r: CatalogResult; index: number; menuKey: string; openMenu: string | null; setOpenMenu: (k: string | null) => void }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const mine = useStore((s) => findMine(s.items, r));
  const addFromSearch = useStore((s) => s.addFromSearch);
  const btn = addButtonProps(mine, t);
  const open = openMenu === menuKey;
  const act = () => (mine ? router.push(`/title/${mine.id}`) : setOpenMenu(open ? null : menuKey));
  const badge = index === 0 ? t("Топ недели") : r.y >= new Date().getFullYear() - 1 ? t("Новинка сезона") : t("Популярное");
  const hue = catalogBg(hueOfKey(r.key));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={act}
      onKeyDown={(e) => e.key === "Enter" && act()}
      style={{ background: `linear-gradient(to top,rgba(2,6,23,.85),rgba(2,6,23,.05) 70%),${r.img ? `url("${r.img}") center 20%/cover, ${hue}` : hue}` }}
      className="relative flex h-60 w-[min(580px,88%)] flex-none cursor-pointer snap-start flex-col justify-end gap-2 overflow-hidden rounded-[26px] p-[22px] text-slate-100 shadow-card"
    >
      <span className="self-start rounded-full bg-[rgba(2,6,23,.55)] px-3 py-1 font-display text-xs font-semibold tracking-[.06em] text-[#2DD4BF] backdrop-blur-[8px]">{badge}</span>
      <div className="font-display text-[28px] font-bold tracking-[-.03em]">{lang === "en" && r.en ? r.en : r.t}</div>
      <div className="text-sm text-slate-300">
        {[typeName(r.type, t), r.y || "", r.g.slice(0, 2).map(t).join(", ")].filter(Boolean).join(" · ")}
      </div>
      <div className="flex items-center gap-3.5">
        {r.rating ? <span className="font-display text-base font-semibold text-amber-400">★ {r.rating.toFixed(1)}</span> : null}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); act(); }}
          style={{ background: btn.bg, color: btn.fg }}
          className="flex h-11 items-center rounded-[14px] px-5 font-display text-sm font-semibold hover:shadow-[0_0_22px_rgba(45,212,191,.5)]"
        >
          {btn.label}
        </button>
      </div>
      <AnimatePresence>{open && <AddMenu type={r.type} onPick={(st) => void addFromSearch(r, st)} onClose={() => setOpenMenu(null)} className="bottom-[84px] left-[22px] min-w-[200px]" />}</AnimatePresence>
    </div>
  );
}

/** Названия источников для бейджа на карточке результата поиска */
const SOURCE_LABEL: Record<string, string> = { tmdb: "TMDB", shikimori: "Shikimori", openlibrary: "Open Library" };

/** Оттенок заглушки из строки: у результата поиска нет числового id */
const hueOfKey = (key: string) => [...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);

/** Карточка результата живого поиска: внешний постер, источник, добавление в библиотеку */
export function SearchCard({ r, menuKey, openMenu, setOpenMenu }: { r: CatalogResult; menuKey: string; openMenu: string | null; setOpenMenu: (k: string | null) => void }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const mine = useStore((s) => findMine(s.items, r));
  const addFromSearch = useStore((s) => s.addFromSearch);
  const btn = addButtonProps(mine, t);
  const open = openMenu === menuKey;
  const act = () => (mine ? router.push(`/title/${mine.id}`) : setOpenMenu(open ? null : menuKey));
  const name = lang === "en" && r.en ? r.en : r.t;
  const alt = r.en && r.en !== r.t ? (lang === "en" ? r.t : r.en) : "";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={name}
        onClick={act}
        onKeyDown={(e) => e.key === "Enter" && act()}
        whileHover={{ y: -4, boxShadow: "0 18px 40px rgba(0,0,0,.4), 0 0 0 1px color-mix(in srgb, var(--acc) 50%, transparent)" }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        style={{ background: r.img ? `url("${r.img}") center/cover, ${catalogBg(hueOfKey(r.key))}` : catalogBg(hueOfKey(r.key)) }}
        className="relative aspect-[2/3] cursor-pointer overflow-hidden rounded-[18px] shadow-card"
      >
        {!r.img && <div className="absolute top-2.5 left-3 font-display text-[34px] font-bold text-white/35">{initials(name)}</div>}
        <span className="absolute top-2.5 right-2.5 rounded-full bg-[rgba(2,6,23,.55)] px-[9px] py-[3px] font-display text-[11px] font-semibold text-slate-100 backdrop-blur-[8px]">
          {SOURCE_LABEL[r.source] ?? r.source}
        </span>
        <AnimatePresence>{open && <AddMenu type={r.type} onPick={(st) => void addFromSearch(r, st)} onClose={() => setOpenMenu(null)} className="right-2 bottom-14 left-2" />}</AnimatePresence>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); act(); }}
          style={{ background: btn.bg, color: btn.fg }}
          className="absolute right-2 bottom-2 left-2 flex h-11 items-center justify-center rounded-[14px] font-display text-sm font-semibold backdrop-blur-[8px] hover:shadow-[0_0_22px_rgba(45,212,191,.5)]"
        >
          {btn.label}
        </button>
      </motion.div>
      <div className="font-display text-[15px] leading-tight font-semibold">{name}</div>
      {alt && <div className="truncate text-xs text-fg2">{alt}</div>}
      {r.rating ? (
        <div className="font-display text-[13px] font-semibold">
          <span className="text-star">★</span> {r.rating.toFixed(1)}
        </div>
      ) : null}
      <div className="text-xs text-muted">
        {typeName(r.type, t)}
        {r.y ? ` · ${r.y}` : ""}
        {r.author ? ` · ${r.author}` : ""}
        {r.g.length ? ` · ${r.g.slice(0, 2).map(t).join(", ")}` : ""}
      </div>
    </div>
  );
}
