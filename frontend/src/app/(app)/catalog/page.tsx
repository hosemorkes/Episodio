"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ReviewList } from "@/components/ReviewList";
import { PageHeader } from "@/components/PageHeader";
import { TitleCard } from "@/components/TitleCard";
import { Pill, Pills, PrimaryButton, Skeleton } from "@/components/ui";
import { needsReview } from "@/lib/enrich";
import { useT } from "@/lib/i18n";
import { STATUSES, statusLabel, TYPES } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { TitleStatus, TitleType } from "@/lib/types";

type TypeFilter = "all" | TitleType;

/** Размеры страницы «Моей библиотеки»; 0 — показать все */
const PAGE_SIZES = [20, 50, 100, 0];

export default function CatalogPage() {
  const t = useT();
  const { items, hydrated } = useStore();
  const [view, setView] = useState<"mine" | "review">("mine");
  const [tfilter, setTfilter] = useState<TypeFilter>("all");
  const [cfilter, setCfilter] = useState<"all" | TitleStatus>("all");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [lq, setLq] = useState("");
  const [fOpen, setFOpen] = useState(false);
  const [fGenres, setFGenres] = useState<string[]>([]);

  const reviewCount = useMemo(() => items.filter(needsReview).length, [items]);
  // Количества у типов считаются в рамках выбранного статуса и поиска, чтобы совпадать с тем, что показано
  const byStatus = useMemo(() => items.filter((x) => cfilter === "all" || x.st === cfilter), [items, cfilter]);
  const query = lq.trim().toLowerCase();
  const found = useMemo(
    () =>
      byStatus.filter(
        (x) =>
          (!query || x.t.toLowerCase().includes(query) || (x.en ?? "").toLowerCase().includes(query)) && fGenres.every((g) => x.g.includes(g)),
      ),
    [byStatus, query, fGenres],
  );
  // Все жанры библиотеки по числу тайтлов (заглушка «Без жанра» не жанр)
  const genreList = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((x) => x.g.forEach((g) => g !== "Без жанра" && g !== "No genre" && m.set(g, (m.get(g) ?? 0) + 1)));
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);
  const nf = (cfilter !== "all" ? 1 : 0) + (tfilter !== "all" ? 1 : 0) + fGenres.length;
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: found.length };
    found.forEach((x) => (c[x.type] = (c[x.type] || 0) + 1));
    return c;
  }, [found]);
  const mine = tfilter === "all" ? found : found.filter((x) => x.type === tfilter);

  const pages = pageSize ? Math.max(1, Math.ceil(mine.length / pageSize)) : 1;
  const cur = Math.min(page, pages - 1);
  const shown = pageSize ? mine.slice(cur * pageSize, (cur + 1) * pageSize) : mine;

  // Любая смена фильтра возвращает на первую страницу
  const pickStatus = (v: "all" | TitleStatus) => { setCfilter(v); setPage(0); };
  const pickType = (v: TypeFilter) => { setTfilter(v); setPage(0); };
  const toggleGenre = (g: string) => { setFGenres((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g])); setPage(0); };
  const resetFilters = () => { setCfilter("all"); setTfilter("all"); setFGenres([]); setPage(0); };

  const pager =
    mine.length > PAGE_SIZES[0] ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto" role="group" aria-label={t("На странице")}>
          <span className="text-xs text-muted">{t("На странице")}</span>
          {PAGE_SIZES.map((n) => (
            <Pill key={n} h={36} on={pageSize === n} onClick={() => { setPageSize(n); setPage(0); }}>
              {n || t("Все")}
            </Pill>
          ))}
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Pill h={36} on={false} onClick={() => cur > 0 && setPage(cur - 1)}>←</Pill>
            <span className="text-sm text-muted">
              {cur + 1} / {pages}
            </span>
            <Pill h={36} on={false} onClick={() => cur < pages - 1 && setPage(cur + 1)}>→</Pill>
          </div>
        )}
      </div>
    ) : null;

  if (!hydrated) {
    return (
      <>
        <PageHeader kicker={t("Все тайтлы")} title={t("Каталог")} />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[240px]" />
        <Skeleton className="h-[260px]" />
      </>
    );
  }

  const typeTabs: [TypeFilter, string][] = [
    ["all", `${t("Все")} · ${typeCounts.all}`],
    ...TYPES.map(([k, n]) => [k, `${t(n)} · ${typeCounts[k] || 0}`] as [TypeFilter, string]),
  ];

  return (
    <>
      <PageHeader kicker={t("Все тайтлы")} title={t("Каталог")} />
      <Pills
        items={[["mine", t("Моя библиотека")], ["review", t("Требуют проверки") + (reviewCount ? ` · ${reviewCount}` : "")]] as ["mine" | "review", string][]}
        value={view}
        onChange={(v) => { setView(v); pickType("all"); }}
      />

      {view === "review" ? (
        <>
          <Pills items={[["all", t("Все")], ...TYPES.map(([k, n]) => [k, t(n)] as [TypeFilter, string])]} value={tfilter} onChange={pickType} />
          <ReviewList type={tfilter} />
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">{t("Мои тайтлы")}</h2>
            <Link href="/title/new" className="no-underline">
              <PrimaryButton>{t("+ Добавить тайтл")}</PrimaryButton>
            </Link>
          </div>
          <input
            value={lq}
            onChange={(e) => { setLq(e.target.value); setPage(0); }}
            placeholder={t("Поиск по библиотеке")}
            aria-label={t("Поиск по библиотеке")}
            className="h-12 w-full rounded-[16px] border border-line bg-glass px-4 text-[15px] font-medium outline-none focus:border-acc"
          />
          <div className="flex">
            <button
              type="button"
              onClick={() => setFOpen((o) => !o)}
              aria-expanded={fOpen}
              className={`flex h-11 items-center gap-2 rounded-[14px] border bg-glass px-5 font-display text-sm font-semibold hover:border-acc ${nf || fOpen ? "border-acc" : "border-line"}`}
            >
              {t("Фильтр")}
              {nf ? ` · ${nf}` : ""}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {fOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="flex flex-col gap-4 rounded-[22px] border border-line bg-glass p-5 shadow-card">
                  <FilterGroup label={t("Статус")}>
                    <Pill on={cfilter === "all"} onClick={() => pickStatus("all")}>{t("Все")}</Pill>
                    {STATUSES.map(([k, n]) => (
                      <Pill key={k} on={cfilter === k} onClick={() => pickStatus(k)}>
                        {statusLabel(k, tfilter === "all" ? "anime" : tfilter, t, t(n))}
                      </Pill>
                    ))}
                  </FilterGroup>
                  <FilterGroup label={t("Раздел")}>
                    {typeTabs.map(([k, n]) => (
                      <Pill key={k} on={tfilter === k} onClick={() => pickType(k)}>{n}</Pill>
                    ))}
                  </FilterGroup>
                  {genreList.length > 0 && (
                    <FilterGroup label={t("Жанры")}>
                      {genreList.map(([g, n]) => (
                        <Pill key={g} on={fGenres.includes(g)} onClick={() => toggleGenre(g)}>
                          {t(g)} · {n}
                        </Pill>
                      ))}
                    </FilterGroup>
                  )}
                  <button type="button" onClick={resetFilters} className="flex h-11 items-center self-start rounded-xl px-4 font-display text-sm font-semibold text-muted hover:bg-slate-400/10">
                    {t("Сбросить")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {pager}
          <div className="grid grid-cols-2 gap-3.5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-6">
            {shown.map((it) => (
              <TitleCard key={it.id} it={it} />
            ))}
          </div>
          {!mine.length && <div className="py-10 text-center text-[15px] text-muted">{t("Ничего не найдено")}</div>}

          {pager}
        </>
      )}
    </>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
