"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";
import { ICONS, Svg } from "./ui";

const TABS = [
  { href: "/", label: "Дашборд", icon: ICONS.home },
  { href: "/catalog", label: "Каталог", icon: ICONS.catalog },
  { href: "/ai", label: "AI", icon: ICONS.ai },
  { href: "/stats", label: "Статистика", icon: ICONS.stats },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label="Навигация"
      className="fixed bottom-[calc(12px+env(safe-area-inset-bottom))] left-1/2 z-20 flex h-16 w-[calc(100%-24px)] max-w-[560px] -translate-x-1/2 gap-1 rounded-[22px] border border-slate-400/20 bg-glass2 p-1.5 backdrop-blur-[18px]"
    >
      {TABS.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-2xl text-[11px] font-medium no-underline transition-colors ${active ? "text-acc" : "text-muted hover:text-acc"}`}
          >
            {active && (
              <motion.span layoutId="nav-active" className="absolute inset-0 rounded-2xl bg-acc/12" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <Svg d={tab.icon} className="relative" />
            <span className="relative">{t(tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
