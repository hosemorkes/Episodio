"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Пилюля-переключатель: фильтры, статусы, типы */
export function Pill({
  on,
  h = 40,
  className,
  children,
  ...p
}: { on?: boolean; h?: 36 | 40 | 44 } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      aria-pressed={on}
      className={cx(
        "flex flex-none items-center rounded-full border px-4 text-sm font-medium transition-colors hover:border-acc",
        h === 44 ? "h-11 font-semibold" : h === 36 ? "h-9" : "h-10",
        on ? "border-acc bg-acc/15 text-acc" : "border-slate-400/25 text-fg2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Pills<T extends string | number>({
  items,
  value,
  onChange,
  h,
  className,
}: {
  items: [T, string][];
  value: T;
  onChange: (v: T) => void;
  h?: 36 | 40 | 44;
  className?: string;
}) {
  return (
    <div className={cx("flex gap-2 overflow-x-auto", className)}>
      {items.map(([k, n]) => (
        <Pill key={String(k)} on={value === k} h={h} onClick={() => onChange(k)}>
          {n}
        </Pill>
      ))}
    </div>
  );
}

/** Основная кнопка акцентного цвета (≥44px) */
export function PrimaryButton({ className, ...p }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      {...p}
      className={cx(
        "flex h-11 items-center justify-center gap-2.5 rounded-[14px] bg-acc px-5 font-display text-[15px] font-semibold text-onacc transition-shadow hover:shadow-[0_0_24px_color-mix(in_srgb,var(--acc)_60%,transparent)]",
        className,
      )}
    />
  );
}

/** Контурная кнопка */
export function GhostButton({ className, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "flex h-11 items-center rounded-[14px] border border-slate-400/25 px-[18px] font-display text-sm font-semibold transition-colors hover:border-acc",
        className,
      )}
    />
  );
}

export function IconButton({ className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "flex size-11 items-center justify-center rounded-[14px] border border-slate-400/20 bg-glass text-fg transition-colors hover:border-acc",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-4 animate-spin-fast rounded-full border-2 border-onacc/30 border-t-onacc", className)}
    />
  );
}

export function Block({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style} className={cx("block", className)}>
      {children}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden style={style} className={cx("animate-sk rounded-2xl bg-slate-400/20", className)} />;
}

export function Svg({ d, size = 22, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  home: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  catalog: "M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z M8 3v18",
  ai: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z",
  stats: "M4 20V4 M4 20h16 M7 15l4-4 3 3 5-6",
} as const;

/** Цвета диаграмм */
export const CHART = ["var(--acc)", "var(--acc2)", "#818CF8", "#F59E0B", "#F472B6"];
