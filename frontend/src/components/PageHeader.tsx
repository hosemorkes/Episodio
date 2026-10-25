"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { LogoMark } from "./Logo";
import { IconButton, ICONS, Svg } from "./ui";

/** Шапка экрана: логотип, поиск, меню, kicker и H1 */
export function PageHeader({ kicker, title }: { kicker: string; title: string }) {
  const t = useT();
  const router = useRouter();
  const setPalOpen = useStore((s) => s.setPalOpen);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const items: { label: string; run: () => void }[] = [
    { label: t("Лента активности"), run: () => router.push("/feed") },
    { label: t("Витрина"), run: () => router.push("/showcase") },
    { label: t("Настройки"), run: () => router.push("/settings") },
    { label: t("Добавить тайтл"), run: () => router.push("/title/new") },
    { label: t("Поиск"), run: () => setPalOpen(true) },
  ];

  return (
    <header className="flex flex-col gap-[18px]">
      <div className="relative flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-[-.03em] text-fg no-underline hover:text-fg">
          <LogoMark size={34} />
          Episodio
        </Link>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setPalOpen(true)}
            aria-label={t("Поиск")}
            className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-slate-400/20 bg-glass px-[11px] text-fg transition-colors hover:border-acc"
          >
            <Svg d={ICONS.search} />
            <kbd className="hidden rounded-md border border-slate-400/25 px-1.5 py-0.5 font-display text-[11px] text-muted min-[900px]:block">Ctrl K</kbd>
          </button>
          <IconButton onClick={() => setMenu((m) => !m)} aria-label={t("Меню")} aria-expanded={menu} className={menu ? "border-acc" : ""}>
            <Svg d={ICONS.menu} />
          </IconButton>
        </div>
        <AnimatePresence>
          {menu && (
            <>
              <div onClick={() => setMenu(false)} className="fixed inset-0 z-30" />
              <motion.div
                role="menu"
                initial={{ opacity: 0, scale: 0.92, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.16 }}
                style={{ transformOrigin: "top right" }}
                className="absolute top-[54px] right-0 z-[31] flex min-w-[220px] flex-col gap-0.5 rounded-[18px] border border-acc/30 bg-pop p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.5)] backdrop-blur-[16px]"
              >
                {items.map((m) => (
                  <button
                    key={m.label}
                    role="menuitem"
                    type="button"
                    onClick={() => { setMenu(false); m.run(); }}
                    className="flex h-11 items-center rounded-xl px-3.5 text-left text-[15px] font-medium hover:bg-slate-400/15"
                  >
                    {m.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      <div>
        <div className="kicker">{kicker}</div>
        <h1 className="mt-1 font-display text-[26px] font-bold tracking-[-.03em] min-[560px]:text-[34px]">{title}</h1>
      </div>
    </header>
  );
}
