"use client";

import { PageHeader } from "@/components/PageHeader";
import { Block, CHART, Skeleton } from "@/components/ui";
import { easeOutCubic, staggered, useRunProgress } from "@/lib/anim";
import { useLang, useT } from "@/lib/i18n";
import { displayName, tally, unitOf, YEAR_BUCKETS, yearBucket } from "@/lib/rules";
import { useStore } from "@/lib/store";

export default function StatsPage() {
  const t = useT();
  const lang = useLang();
  const { items, hydrated } = useStore();
  // Анимация 1.8 c запускается при каждом открытии страницы и сбрасывается при уходе
  const P = useRunProgress(1.8, 0.15);

  if (!hydrated) {
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

  const lc = (i: number) => staggered(P, i);
  const genres = tally(items, (it) => it.g);
  const gTotal = genres.reduce((a, b) => a + b[1], 0) || 1;
  const countries = tally(items, (it) => [it.c]);
  const cTotal = countries.reduce((a, b) => a + b[1], 0) || 1;
  const cMax = countries[0]?.[1] || 1;
  const buckets = YEAR_BUCKETS.map((l) => [l, 0] as [string, number]);
  items.forEach((it) => (buckets[yearBucket(it.y)][1] += it.ep));
  const bMax = Math.max(1, ...buckets.map((b) => b[1]));
  const top = [...items].sort((a, b) => b.ep - a.ep).slice(0, 5);

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
          <div className="font-display text-base font-semibold">{t("Жанры")}</div>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex size-[130px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${segs.join(",")})` }}>
              <div className="size-[84px] rounded-full bg-card" />
            </div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {genres.map((g, i) => (
                <div key={g[0]} className="flex items-center gap-2" style={{ opacity: lc(i), transform: `translateX(${(1 - lc(i)) * -12}px)` }}>
                  <span className="size-2.5 rounded-[3px]" style={{ background: CHART[i % 5] }} />
                  {t(g[0])} <span className="text-faint">{Math.round((g[1] / gTotal) * 100 * lc(i))}%</span>
                </div>
              ))}
            </div>
          </div>
        </Block>

        <Block className="flex flex-col gap-3">
          <div className="font-display text-base font-semibold">{t("Страны")}</div>
          {countries.map((c, i) => (
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
          <div className="font-display text-base font-semibold">{t("Годы выхода")}</div>
          <div className="flex h-[130px] items-end gap-2.5">
            {buckets.map(([l, v], i) => (
              <div key={l} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div className="w-full rounded-lg bg-acc2 opacity-85" style={{ height: `${Math.max(2, Math.round((v / bMax) * 100 * lc(i)))}%` }} />
                <span className="text-[11px] text-muted">{l}</span>
              </div>
            ))}
          </div>
        </Block>

        <Block className="flex flex-col gap-2.5">
          <div className="font-display text-base font-semibold">{t("Топ по сериям")}</div>
          {top.map((it, i) => (
            <div key={it.id} className="flex items-center gap-3" style={{ opacity: lc(i), transform: `translateX(${(1 - lc(i)) * 16}px)` }}>
              <span className="w-[22px] font-display text-lg font-bold text-acc">{i + 1}</span>
              <span className="flex-1 truncate text-sm">{displayName(it, lang)}</span>
              <span className="font-display text-sm font-semibold text-muted">
                {Math.round(it.ep * lc(i))}
                {unitOf(it.type, t).short}
              </span>
            </div>
          ))}
        </Block>
      </div>
    </>
  );
}
