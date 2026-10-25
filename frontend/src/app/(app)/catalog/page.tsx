"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { CatalogCard, HeroBanner, SearchCard } from "@/components/CatalogCard";
import { PageHeader } from "@/components/PageHeader";
import { TitleCard } from "@/components/TitleCard";
import { Pill, Pills, PrimaryButton, Skeleton } from "@/components/ui";
import { CATALOG } from "@/lib/catalog-data";
import { useLang, useT } from "@/lib/i18n";
import { useCatalogSearch } from "@/lib/useCatalogSearch";
import { ALL_GENRES, findMine, genreCounts, recommend, STATUSES, statusLabel, TYPES, TYPES_PLURAL } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { CatalogItem, TitleStatus, TitleType } from "@/lib/types";
import Link from "next/link";

type TypeFilter = "all" | TitleType;
type YearFilter = "all" | "2020" | "2010" | "2000" | "old";
type AirFilter = "all" | "o" | "d" | "s";
type Sort = "pop" | "rating" | "new";

const YEAR_OK: Record<YearFilter, (y: number) => boolean> = {
  all: () => true,
  "2020": (y) => y >= 2020,
  "2010": (y) => y >= 2010 && y < 2020,
  "2000": (y) => y >= 2000 && y < 2010,
  old: (y) => y < 2000,
};
const SORTERS: Record<Sort, (a: CatalogItem, b: CatalogItem) => number> = {
  rating: (a, b) => b.r - a.r,
  pop: (a, b) => b.p - a.p,
  new: (a, b) => b.y - a.y || b.p - a.p,
};

export default function CatalogPage() {
  const t = useT();
  const lang = useLang();
  const { items, hydrated } = useStore();
  const [view, setView] = useState<"discover" | "mine">("discover");
  const [tfilter, setTfilter] = useState<TypeFilter>("all");
  const [cq, setCq] = useState("");
  const [sugOpen, setSugOpen] = useState(false);
  const [fOpen, setFOpen] = useState(false);
  const [fGenres, setFGenres] = useState<string[]>([]);
  const [fYear, setFYear] = useState<YearFilter>("all");
  const [fStatus, setFStatus] = useState<AirFilter>("all");
  const [fSort, setFSort] = useState<Sort>("pop");
  const [cfilter, setCfilter] = useState<"all" | TitleStatus>("all");
  const [menu, setMenu] = useState<string | null>(null);

  const live = useCatalogSearch(cq, tfilter, view === "discover");
  const q = cq.trim().toLowerCase();
  const nm = (c: CatalogItem) => (lang === "en" ? c.en : c.t);
  const active = !!q || fGenres.length > 0 || fYear !== "all" || fStatus !== "all" || fSort !== "pop";
  const nf = fGenres.length + (fYear !== "all" ? 1 : 0) + (fStatus !== "all" ? 1 : 0) + (fSort !== "pop" ? 1 : 0);

  const list = useMemo(() => CATALOG.filter((c) => tfilter === "all" || c.type === tfilter), [tfilter]);
  const results = useMemo(
    () =>
      list
        .filter(
          (c) =>
            (!q || c.t.toLowerCase().includes(q) || c.en.toLowerCase().includes(q)) &&
            fGenres.every((g) => c.g.includes(g)) &&
            YEAR_OK[fYear](c.y) &&
            (fStatus === "all" || c.s === fStatus),
        )
        .sort(SORTERS[fSort]),
    [list, q, fGenres, fYear, fStatus, fSort],
  );
  const suggestions = q && sugOpen ? CATALOG.filter((c) => c.t.toLowerCase().includes(q) || c.en.toLowerCase().includes(q)).slice(0, 5) : [];

  const shelves = useMemo(() => {
    const pop = [...list].sort(SORTERS.pop);
    const out: { key: string; title: string; sub: string; cards: CatalogItem[] }[] = [
      { key: "pop", title: t("Популярное сейчас"), sub: t("Чаще всего добавляют другие пользователи"), cards: pop.slice(0, 12) },
    ];
    const gc: Record<string, number> = {};
    list.forEach((c) => c.g.forEach((g) => (gc[g] = (gc[g] || 0) + 1)));
    Object.entries(gc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([g]) =>
        out.push({ key: `g-${g}`, title: t("Топ в жанре ") + t(g), sub: t("Лучшие по оценке"), cards: list.filter((c) => c.g.includes(g) && c.r).sort(SORTERS.rating).slice(0, 12) }),
      );
    const rec = recommend(items, list, 10);
    const topG = Object.entries(genreCounts(items))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((x) => t(x[0]))
      .join(", ");
    if (rec.length) out.push({ key: "ai", title: t("AI рекомендует вам"), sub: t("На основе ваших тайтлов: ") + topG, cards: rec });
    return out.filter((s) => s.cards.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, items, lang]);

  const mine = items.filter((x) => (cfilter === "all" || x.st === cfilter) && (tfilter === "all" || x.type === tfilter));

  const toggleGenre = (g: string) => setFGenres((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));
  const reset = () => { setFGenres([]); setFYear("all"); setFStatus("all"); setFSort("pop"); setCq(""); };

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

  // Поиск работает по всем 8 категориям, а подборка (полки) пока статическая и есть не у каждой
  const typeTabs: [TypeFilter, string][] = [["all", t("Все")], ...TYPES.map(([k]) => [k, t(TYPES_PLURAL[k])] as [TypeFilter, string])];

  return (
    <>
      <PageHeader kicker={t("Все тайтлы")} title={t("Каталог")} />
      <Pills
        items={[["discover", t("Обзор")], ["mine", t("Моя библиотека")]] as ["discover" | "mine", string][]}
        value={view}
        onChange={(v) => { setView(v); setTfilter("all"); }}
      />

      {view === "discover" ? (
        <div className="flex flex-col gap-5">
          <div className="mx-auto flex w-full max-w-[760px] gap-2.5">
            <div className="relative min-w-0 flex-1">
              <input
                value={cq}
                onChange={(e) => { setCq(e.target.value); setSugOpen(true); }}
                placeholder={t("Поиск по каталогу: название, оригинал…")}
                aria-label={t("Поиск")}
                className="h-14 w-full rounded-[18px] border border-line bg-glass px-5 font-display text-[17px] font-medium shadow-card outline-none focus:border-acc"
              />
              {suggestions.length > 0 && (
                <>
                  <div className="fixed inset-0 z-[7]" onClick={() => setSugOpen(false)} />
                  <div className="absolute top-[62px] right-0 left-0 z-[8] flex flex-col gap-0.5 rounded-[18px] border border-acc/35 bg-pop p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.35)]">
                    {suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCq(nm(c)); setSugOpen(false); }}
                        className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-3.5 text-left text-[15px] font-medium hover:bg-slate-400/15"
                      >
                        <span>{nm(c)}</span>
                        <span className="text-xs text-muted">
                          {t(TYPES.find(([k]) => k === c.type)![1])} · {c.y}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFOpen((o) => !o)}
              aria-expanded={fOpen}
              className={`flex h-14 items-center gap-2 rounded-[18px] border bg-glass px-5 font-display text-[15px] font-semibold shadow-card hover:border-acc ${nf || fOpen ? "border-acc" : "border-line"}`}
            >
              {t("Фильтры")}
              {nf ? ` · ${nf}` : ""}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {fOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-4 rounded-[22px] border border-line bg-glass p-5 shadow-card">
                  <FilterGroup label={t("Жанры")}>
                    {ALL_GENRES.map((g) => (
                      <Pill key={g} on={fGenres.includes(g)} onClick={() => toggleGenre(g)}>
                        {t(g)}
                      </Pill>
                    ))}
                  </FilterGroup>
                  <FilterGroup label={t("Год выпуска")}>
                    {([["all", t("Любой")], ["2020", "2020+"], ["2010", "2010–2019"], ["2000", "2000–2009"], ["old", t("до 2000")]] as [YearFilter, string][]).map(([k, n]) => (
                      <Pill key={k} on={fYear === k} onClick={() => setFYear(k)}>{n}</Pill>
                    ))}
                  </FilterGroup>
                  <FilterGroup label={t("Статус")}>
                    {([["all", t("Любой")], ["o", t("Выходит")], ["d", t("Завершён")], ["s", t("Анонс")]] as [AirFilter, string][]).map(([k, n]) => (
                      <Pill key={k} on={fStatus === k} onClick={() => setFStatus(k)}>{n}</Pill>
                    ))}
                  </FilterGroup>
                  <FilterGroup label={t("Сортировка")}>
                    {([["pop", t("По популярности")], ["rating", t("По рейтингу")], ["new", t("Новинки")]] as [Sort, string][]).map(([k, n]) => (
                      <Pill key={k} on={fSort === k} onClick={() => setFSort(k)}>{n}</Pill>
                    ))}
                  </FilterGroup>
                  <button type="button" onClick={reset} className="flex h-11 items-center self-start rounded-xl px-4 font-display text-sm font-semibold text-muted hover:bg-slate-400/10">
                    {t("Сбросить")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Pills items={typeTabs} value={tfilter} onChange={setTfilter} h={44} />
          {menu && <div className="fixed inset-0 z-[4]" onClick={() => setMenu(null)} />}

          {!active ? (
            <>
              <div className="snap-row pb-1">
                {[...list].sort(SORTERS.pop).slice(0, 5).map((c, i) => (
                  <HeroBanner key={c.id} c={c} index={i} menuKey={`hero-${c.id}`} openMenu={menu} setOpenMenu={setMenu} />
                ))}
              </div>
              {!shelves.length && (
                <div className="py-10 text-center text-[15px] text-muted">{t("В подборке пока нет этой категории. Введите название в строке поиска, и тайтл найдётся во внешних каталогах.")}</div>
              )}
              {shelves.map((sh) => (
                <section key={sh.key} className="flex flex-col gap-3">
                  <div>
                    <h2 className="font-display text-xl font-semibold tracking-[-.02em]">{sh.title}</h2>
                    <div className="mt-0.5 text-[13px] text-muted">{sh.sub}</div>
                  </div>
                  <div className="snap-row px-0.5 pt-1 pb-2">
                    {sh.cards.map((c) => (
                      <CatalogCard key={c.id} c={c} width="150px" menuKey={`${sh.key}-${c.id}`} openMenu={menu} setOpenMenu={setMenu} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          ) : (
            <>
              {live.active && (
                <section className="flex flex-col gap-3">
                  <h2 className="font-display text-xl font-semibold tracking-[-.02em]">
                    {t("Найдено в каталогах")}
                    {!live.busy && !live.error ? `: ${live.results.length}` : ""}
                  </h2>
                  {live.busy ? (
                    <>
                      <div className="text-[13px] text-muted">{t("Ищем в каталогах…")}</div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3.5 gap-y-[18px]">
                        {Array.from({ length: 6 }, (_, i) => (
                          <Skeleton key={i} className="aspect-[2/3] rounded-[18px]" />
                        ))}
                      </div>
                    </>
                  ) : live.error ? (
                    <div role="alert" className="rounded-2xl border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm">{live.error}</div>
                  ) : (
                    <>
                      {live.warnings.length > 0 && (
                        <div className="text-[13px] text-muted">
                          {t("Часть источников недоступна: ")}
                          {live.warnings.join("; ")}
                        </div>
                      )}
                      {live.results.length ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3.5 gap-y-[18px]">
                          {live.results.map((r) => (
                            <SearchCard key={r.key} r={r} menuKey={`s-${r.key}`} openMenu={menu} setOpenMenu={setMenu} />
                          ))}
                        </div>
                      ) : (
                        <div className="py-6 text-center text-[15px] text-muted">{t("В каталогах ничего не найдено")}</div>
                      )}
                    </>
                  )}
                </section>
              )}
              {(!live.active || results.length > 0) && (
                <section className="flex flex-col gap-3">
                  <h2 className="font-display text-xl font-semibold tracking-[-.02em]">
                    {live.active ? t("В подборке: ") : t("Найдено: ")}
                    {results.length}
                  </h2>
                  {results.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3.5 gap-y-[18px]">
                      {results.map((c) => (
                        <CatalogCard key={c.id} c={c} width="100%" menuKey={`r-${c.id}`} openMenu={menu} setOpenMenu={setMenu} />
                      ))}
                    </div>
                  ) : (
                    <div className="py-10 text-center text-[15px] text-muted">{t("Ничего не найдено")}</div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold">{t("Мои тайтлы")}</h2>
            <Link href="/title/new" className="no-underline">
              <PrimaryButton>{t("+ Добавить тайтл")}</PrimaryButton>
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            <Pill on={cfilter === "all"} onClick={() => setCfilter("all")}>{t("Все")}</Pill>
            {STATUSES.map(([k, n]) => (
              <Pill key={k} on={cfilter === k} onClick={() => setCfilter(k)}>
                {statusLabel(k, tfilter === "all" ? "anime" : tfilter, t, t(n))}
              </Pill>
            ))}
          </div>
          <Pills items={[["all", t("Все")], ...TYPES.map(([k, n]) => [k, t(n)] as [TypeFilter, string])]} value={tfilter} onChange={setTfilter} />
          <div className="grid grid-cols-2 gap-3.5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-6">
            {mine.map((it) => (
              <TitleCard key={it.id} it={it} />
            ))}
          </div>
          {!mine.length && <div className="py-10 text-center text-[15px] text-muted">{t("Ничего не найдено")}</div>}
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
