"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { TitleCard } from "@/components/TitleCard";
import { Block, PrimaryButton, Skeleton } from "@/components/ui";
import { draftReview } from "@/lib/epi";
import { useLang, useT } from "@/lib/i18n";
import { altName, displayName, genreLine, hasSeasons, initials, isReading, pct, posterBg, unitOf } from "@/lib/rules";
import { totalsOf, weekCounts, weekRange } from "@/lib/stats";
import { useStore } from "@/lib/store";
import { useStats } from "@/lib/useStats";

const RECENT_LIMIT = 12;
const WEEK_DAYS =["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function greeting(hour: number) {
  return hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
}

export default function Dashboard() {
  const t = useT();
  const lang = useLang();
  const { items, log, lastId, hydrated, mark } = useStore();
  const { stats } = useStats();

  if (!hydrated) return <DashboardSkeleton />;

  const now = new Date();
  const header = <PageHeader kicker={t("Сегодня")} title={t(greeting(now.getHours()))} />;

  if (!items.length) {
    return (
      <>
        {header}
        <Block className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="font-display text-xl font-semibold">{t("Библиотека пуста")}</div>
          <div className="text-sm text-muted">{t("Добавьте первый тайтл, чтобы начать отслеживать прогресс.")}</div>
          <Link href="/title/new" className="no-underline">
            <PrimaryButton>{t("+ Добавить тайтл")}</PrimaryButton>
          </Link>
        </Block>
      </>
    );
  }

  // «Продолжить»: последняя тронутая карточка любого типа, до первого действия — первая недосмотренная
  const hero = items.find((x) => x.id === lastId) ?? items.find((x) => x.tot === 0 || x.ep < x.tot) ?? items[0];
  const hu = unitOf(hero.type, t);
  const next = hero.tot > 0 ? Math.min(hero.ep + 1, hero.tot) : hero.ep + 1;
  // Серии и главы считаются раздельно: главы манги и книг в «серии» не входят
  const totals = totalsOf(items);
  const total = totals.episodes;

  // Отметки по дням недели из журнала на сервере; сегодняшний столбик не отстаёт от только что нажатого «+»
  const { from, todayIdx } = weekRange(now);
  const todayMarks = log.filter((l) => l.day === "СЕГОДНЯ").length;
  const serverWeek = stats && stats.from === from ? weekCounts(stats.activity, from) : Array(7).fill(0);
  const week = serverWeek.map((v, i) => (i === todayIdx ? Math.max(v, todayMarks) : v));
  const weekMax = Math.max(4, ...week);

  const noted = items.find((x) => x.note);

  // «Мои тайтлы»: сервер отдаёт записи по updated_at (свежие первыми); только что тронутая карточка идёт первой
  const recent = [...items.filter((x) => x.id === lastId), ...items.filter((x) => x.id !== lastId)].slice(0, RECENT_LIMIT);

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-[2fr_1fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex min-h-[200px] items-center gap-[18px] rounded-3xl border border-acc/30 bg-card bg-[linear-gradient(135deg,color-mix(in_srgb,var(--acc)_18%,transparent),color-mix(in_srgb,var(--acc2)_6%,transparent)_60%)] p-[22px] min-[560px]:col-span-2 min-[1100px]:col-span-1"
        >
          <div
            style={{ background: posterBg(hero.img, hero.h) }}
            className="flex h-[156px] w-[110px] flex-none items-end rounded-[14px] p-2.5 font-display text-[26px] font-bold text-white/90 shadow-[0_12px_30px_rgba(0,0,0,.4)]"
          >
            {!hero.img && initials(hero.t)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="font-display text-xs font-semibold tracking-[.1em] text-acc">{t("ПРОДОЛЖИТЬ")}</div>
            <Link href={`/title/${hero.id}`} className="font-display text-2xl font-bold tracking-[-.02em] text-fg no-underline hover:text-fg">
              {displayName(hero, lang)}
            </Link>
            <div className="text-sm text-fg2">{altName(hero, lang)}</div>
            <div className="text-sm text-muted">
              {[
                ...(hasSeasons(hero.type) ? [t("Сезон ") + (hero.se ?? 1)] : []),
                ...(isReading(hero.type) && hero.vol ? [t("Том ") + hero.vol] : []),
                hero.type === "movie" ? t("Фильм") : hu.line + next + (hero.tot > 0 ? t(" из ") + hero.tot : ""),
                genreLine(hero.g, t),
              ].join(" · ")}
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-400/20">
              <div className="h-full bg-acc shadow-[0_0_12px_var(--acc)] transition-[width] duration-[400ms]" style={{ width: `${pct(hero.ep, hero.tot)}%` }} />
            </div>
            <PrimaryButton onClick={() => mark(hero.id)} className="self-start whitespace-nowrap px-4! min-[560px]:px-5! hover:-translate-y-px">
              {hero.type === "movie" ? t("Отметить просмотр") : hu.mark + next}
            </PrimaryButton>
          </div>
        </motion.div>

        <Block className="flex flex-col gap-3">
          <div className="text-[13px] text-muted">{t("Всего серий")}</div>
          <div className="flex flex-1 items-center justify-center">
            <motion.div key={total} initial={{ scale: 1.12, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-[56px] leading-none font-bold tracking-[-.04em]">
              {total}
            </motion.div>
          </div>
          {totals.chapters > 0 && (
            <div className="text-[13px] text-muted">
              {t("Прочитано глав: ")}
              {totals.chapters}
            </div>
          )}
        </Block>

        <Block className="flex flex-col gap-3">
          <div className="text-[13px] text-muted">{t("Эта неделя")}</div>
          <div className="flex h-[72px] items-end gap-1.5">
            {week.map((v, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div
                  className={`w-full rounded-md transition-[height] duration-[400ms] ${i === todayIdx ? "bg-acc" : "bg-acc2/45"}`}
                  style={{ height: `${Math.max(6, (v / weekMax) * 100)}%` }}
                />
                <span className="text-[10px] text-faint">{t(WEEK_DAYS[i])}</span>
              </div>
            ))}
          </div>
        </Block>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="mt-2 font-display text-lg font-semibold">{t("Мои тайтлы")}</h2>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-faint max-[899px]:inline">{t("свайп → отметить · ← детали")}</span>
          <Link
            href="/title/new"
            className="flex h-11 items-center rounded-[14px] border border-acc/40 bg-acc/15 px-4 font-display text-sm font-semibold text-acc no-underline transition-colors hover:bg-acc/25 hover:text-acc"
          >
            {t("+ Добавить тайтл")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-6">
        {recent.map((it) => (
          <TitleCard key={it.id} it={it} />
        ))}
      </div>

      {noted?.note && (
        <Block>
          <div className="mb-2 text-[13px] text-muted">
            {t("Последняя заметка")} · {displayName(noted, lang)}
          </div>
          <div className="font-display text-lg leading-[1.4] font-medium text-pretty">{noted.note}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-acc/12 px-2.5 py-1 text-xs text-acc">{noted.rate ? `${noted.rate} / 10` : t("без оценки")}</span>
            {draftReview(noted.note, t).tags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-400/12 px-2.5 py-1 text-xs">
                {tag}
              </span>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-[120px]" />
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-[2fr_1fr_1fr]">
        <Skeleton className="h-[200px] rounded-3xl min-[560px]:col-span-2 min-[1100px]:col-span-1" />
        <Skeleton className="h-[200px] rounded-3xl" />
        <Skeleton className="h-[200px] rounded-3xl" />
      </div>
      <div className="grid grid-cols-2 gap-3.5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[3/4] rounded-[20px]" />
        ))}
      </div>
    </>
  );
}
