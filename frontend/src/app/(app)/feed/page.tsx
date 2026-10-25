"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";

export default function FeedPage() {
  const t = useT();
  const { log, hydrated, loadMoreLog } = useStore();
  const sentinel = useRef<HTMLDivElement>(null);

  // Бесконечный скролл: когда нижний маркер входит в экран, с сервера подгружается следующая страница ленты.
  // Наблюдатель пересоздаётся при росте ленты, поэтому, если маркер всё ещё на экране, подгрузка продолжится
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && void loadMoreLog(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hydrated, log.length, loadMoreLog]);

  return (
    <>
      <PageHeader kicker={t("Дневник")} title={t("Лента активности")} />
      {!hydrated ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-[18px]" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col pl-2">
          {!log.length && <div className="py-10 text-center text-[15px] text-muted">{t("Пока нет отметок. Отметьте серию или главу, и она появится здесь.")}</div>}
          {log.map((f, i) => (
            <motion.div
              key={log.length - i}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex gap-4"
            >
              <div className="flex flex-col items-center">
                <span className="mt-5 size-3 rounded-full bg-acc shadow-[0_0_12px_var(--acc)]" />
                <span className="w-0.5 flex-1 bg-slate-400/20" />
              </div>
              <div className="my-1.5 flex flex-1 items-center justify-between gap-3 rounded-[18px] border border-line bg-glass px-[18px] py-3.5 shadow-card">
                <div>
                  <div className="font-display text-xs font-semibold tracking-[.08em] text-acc">{t(f.day)}</div>
                  <div className="mt-0.5 font-display text-base font-semibold">{f.title}</div>
                  <div className="text-[13px] text-muted">
                    {f.u === "film" ? t("Фильм") : (f.u === "ch" ? t("Глава ") : t("Серия ")) + f.ep}
                  </div>
                </div>
                <div className="font-display text-sm font-semibold text-faint">{f.time}</div>
              </div>
            </motion.div>
          ))}
          <div ref={sentinel} className="h-1" />
        </div>
      )}
    </>
  );
}
