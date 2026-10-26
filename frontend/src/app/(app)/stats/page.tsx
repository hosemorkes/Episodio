"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Block, CHART, GhostButton, Skeleton } from "@/components/ui";
import { easeOutCubic, staggered, useRunProgress } from "@/lib/anim";
import { useLang, useT } from "@/lib/i18n";
import { displayName, TYPES, unitOf, YEAR_BUCKETS } from "@/lib/rules";
import { isStatsEmpty, libraryBreakdown, ratingBreakdown } from "@/lib/stats";
import { useStore } from "@/lib/store";
import type { TitleType } from "@/lib/types";
import { useStats } from "@/lib/useStats";

type TypeFilter = "all" | TitleType;

export default function StatsPage() {
  const t = useT();
  const lang = useLang();
  const hydrated = useStore((s) => s.hydrated);
  const items = useStore((s) => s.items);
  // У каждого блока свой выбор раздела
  const [gType, setGType] = useState<TypeFilter>("all");
  const [cType, setCType] = useState<TypeFilter>("all");
  const [yType, setYType] = useState<TypeFilter>("all");
  const [tType, setTType] = useState<TypeFilter>("all");
  const [rType, setRType] = useState<TypeFilter>("all");
  const { stats, statsError, reload } = useStats();
  // Анимация 1.8 c запускается при каждом открытии страницы (когда данные есть) и сбрасывается при уходе
  const P = useRunProgress(1.8, 0.15, !!stats && !isStatsEmpty(stats));

  if (!hydrated || (!stats && !statsError)) {
    return (
      <>
        <PageHeader kicker={t("Wrapped круглый год")} title={t("Статистика")} />
        <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-3xl" />
          ))}
        </div>
      </>
    );
  }

  if (!stats) {
    return (
      <>
        <PageHeader kicker={t("Wrapped круглый год")} title={t("Статистика")} />
        <Block className="flex flex-wrap items-center justify-between gap-3">
          <div role="alert" className="text-sm">{statsError}</div>
          <GhostButton onClick={() => void reload()}>{t("Повторить")}</GhostButton>
        </Block>
      </>
    );
  }
  if (isStatsEmpty(stats)) {
    return (
      <>
        <PageHeader kicker={t("Wrapped круглый год")} title={t("Статистика")} />
        <Block className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="font-display text-xl font-semibold">{t("Пока нечего считать")}</div>
          <div className="text-sm text-muted">{t("Добавьте первый тайтл, и здесь появятся жанры, страны и годы выхода.")}</div>
        </Block>
      </>
    );
  }

  const lc = (i: number) => staggered(P, i);
  // Разрезы считаются по библиотеке в сторе (каждая карточка = 1): новые жанры видны сразу, раздел выбирается в каждом блоке
  const genres = libraryBreakdown(items, gType).genres;
  const gTotal = genres.reduce((a, b) => a + b[1], 0) || 1;
  const countries = libraryBreakdown(items, cType).countries;
  const cTotal = countries.reduce((a, b) => a + b[1], 0) || 1;
  const cMax = countries[0]?.[1] || 1;
  const buckets = libraryBreakdown(items, yType).years.map((v, i) => [YEAR_BUCKETS[i], v] as [string, number]);
  const bMax = Math.max(1, ...buckets.map((b) => b[1]));
  const top = libraryBreakdown(items, tType).top;
  const ratings = ratingBreakdown(items, rType);
  const rMax = Math.max(1, ...ratings.counts);
  const noData = <div className="text-sm text-muted">{t("Нет данных")}</div>;

  // Кольцо «собирается» по дуге: cut — сколько процентов окружности уже нарисовано
  const cut = easeOutCubic(Math.min(1, P)) * 100;
  const segs: string[] = [];
  let acc = 0;
  genres.forEach((g, i) => {
    const a = (acc / gTotal) * 100;
    acc += g[1];
    const b = (acc / gTotal) * 100;
    if (a < cut) segs.push(`${CHART[i % 5]} ${a}% ${Math.min(b, cut)}%`);
  });
  segs.push(`rgba(148,163,184,.14) ${cut}% 100%`);

  return (
    <>
      <PageHeader kicker={t("Wrapped круглый год")} title={t("Статистика")} />
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <Block className="flex flex-col gap-3.5">
          <BlockTitle title={t("Жанры")} value={gType} onChange={setGType} />
          {genres.length ? (
            <>
              <div className="mx-auto flex aspect-square w-full max-w-[320px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${segs.join(",")})` }}>
                <div className="size-[62%] rounded-full bg-card" />
              </div>
              <div className="flex max-h-[220px] flex-wrap gap-x-5 gap-y-1.5 overflow-y-auto text-[13px]">
                {genres.map((g, i) => (
                  <div key={g[0]} className="flex items-center gap-2" style={{ opacity: lc(i), transform: `translateX(${(1 - lc(i)) * -12}px)` }}>
                    <span className="size-2.5 rounded-[3px]" style={{ background: CHART[i % 5] }} />
                    {t(g[0])} <span className="text-faint">{Math.round((g[1] / gTotal) * 100 * lc(i))}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            noData
          )}
        </Block>

        <Block className="flex flex-col gap-3">
          <BlockTitle title={t("Страны")} value={cType} onChange={setCType} />
          {!countries.length && noData}
          {countries.slice(0, 10).map((c, i) => (
            <div key={c[0]} style={{ opacity: lc(i) }}>
              <div className="mb-1 flex justify-between text-[13px]">
                <span>{t(c[0])}</span>
                <span className="text-faint">{Math.round((c[1] / cTotal) * 100 * lc(i))}%</span>
              </div>
              <div className="h-2 rounded bg-slate-400/15">
                <div className="h-full rounded bg-[linear-gradient(90deg,var(--acc),var(--acc2))]" style={{ width: `${Math.round((c[1] / cMax) * 100 * lc(i))}%` }} />
              </div>
            </div>
          ))}
        </Block>

        <Block className="flex flex-col gap-3">
          <BlockTitle title={t("Годы выхода")} value={yType} onChange={setYType} />
          <div className="flex h-[130px] items-end gap-2.5">
            {buckets.map(([l, v], i) => (
              <div key={l} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div className="w-full rounded-lg bg-acc2 opacity-85" style={{ height: `${Math.max(2, Math.round((v / bMax) * 100 * lc(i)))}%` }} />
                <span className="text-[11px] text-muted">{l}</span>
              </div>
            ))}
          </div>
        </Block>

        <Block className="flex flex-col gap-3 min-[560px]:col-span-2">
          <BlockTitle title={t("Оценки")} value={rType} onChange={setRType} />
          {ratings.rated ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-muted">
                <span>
                  {t("Средняя оценка: ")}
                  <b className="font-display text-lg text-fg">{ratings.avg}</b>
                </span>
                <span>
                  {t("С оценкой: ")}
                  {ratings.rated}
                </span>
                <span>
                  {t("Без оценки: ")}
                  {ratings.unrated}
                </span>
              </div>
              <div className="flex h-[130px] items-end gap-2">
                {ratings.counts.map((v, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[11px] text-faint">{v || ""}</span>
                    <div className="w-full rounded-lg bg-acc opacity-85" style={{ height: `${v ? Math.max(4, Math.round((v / rMax) * 100 * lc(i))) : 2}%` }} />
                    <span className="text-[11px] text-muted">{i + 1}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">{t("Пока нет оценок")}</div>
          )}
        </Block>

        <Block className="flex flex-col gap-2.5">
          <BlockTitle title={t("Топ по сериям")} value={tType} onChange={setTType} />
          {!top.length && <div className="text-sm text-muted">{t("Пока нет отмеченных серий и глав.")}</div>}
          {top.map(({ item: it, progress }, i) => (
            <div key={it.id} className="flex items-center gap-3" style={{ opacity: lc(i), transform: `translateX(${(1 - lc(i)) * 16}px)` }}>
              <span className="w-[22px] font-display text-lg font-bold text-acc">{i + 1}</span>
              <span className="flex-1 truncate text-sm">{displayName(it, lang)}</span>
              <span className="font-display text-sm font-semibold text-muted">
                {Math.round(progress * lc(i))}
                {unitOf(it.type, t).short}
              </span>
            </div>
          ))}
        </Block>
      </div>
    </>
  );
}

/** Заголовок блока с выбором раздела (Все, Аниме, Мультсериал…) */
function BlockTitle({ title, value, onChange }: { title: string; value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="font-display text-base font-semibold">{title}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TypeFilter)}
        aria-label={t("Раздел")}
        className="h-9 rounded-full border border-slate-400/25 bg-bg px-3 text-sm font-medium outline-none focus:border-acc"
      >
        <option value="all">{t("Все")}</option>
        {TYPES.map(([k, n]) => (
          <option key={k} value={k}>
            {t(n)}
          </option>
        ))}
      </select>
    </div>
  );
}
