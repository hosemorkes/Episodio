import { translate } from "@/lib/i18n-core";
import { initials, posterBg, typeName } from "@/lib/rules";
import { GENITIVE, periodLabel } from "@/lib/showcases";
import type { Lang, ShowcaseView } from "@/lib/types";

/** Публичная витрина: серверный компонент без состояния и без доступа к библиотеке, только то, что пришло в view */
export function PublicShowcase({ view, handle, lang }: { view: ShowcaseView; handle: string; lang: Lang }) {
  const t = (ru: string) => translate(lang, ru);
  const chips = [view.type === "all" ? t("Все категории") : t(GENITIVE[view.type]), periodLabel(view.year, view.month, t)];

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pt-[calc(28px+env(safe-area-inset-top))] pb-[calc(48px+env(safe-area-inset-bottom))]">
        <header className="flex flex-col gap-3">
          <div className="kicker">
            {t("ВИТРИНА")} · @{handle}
          </div>
          <h1 className="font-display text-[30px] leading-[1.1] font-bold tracking-[-.03em] text-balance min-[560px]:text-[44px]">{view.title}</h1>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-slate-400/15 px-3 py-[5px] text-xs">
                {c}
              </span>
            ))}
          </div>
        </header>

        {!view.cards.length ? (
          <div className="rounded-3xl border border-line bg-card px-6 py-16 text-center text-muted">{t("Пока здесь пусто")}</div>
        ) : (
          <ol className="grid grid-cols-2 gap-x-4 gap-y-6 min-[640px]:grid-cols-4">
            {view.cards.map((c, i) => {
              const name = lang === "en" && c.en ? c.en : c.t;
              const meta = [c.y || "", c.g.slice(0, 2).map(t).join(", ")].filter(Boolean).join(" · ");
              return (
                <li key={`${c.t}-${i}`} className="flex min-w-0 flex-col gap-2">
                  <div style={{ background: posterBg(undefined, [(i * 47) % 360, (i * 47 + 40) % 360]) }} className="relative aspect-[2/3] overflow-hidden rounded-[18px] shadow-card">
                    {c.img ? (
                      // eslint-disable-next-line @next/next/no-img-element -- внешние постеры и маршрут витрины, оптимизатор Next не нужен
                      <img src={c.img} alt={name} loading={i < 4 ? "eager" : "lazy"} className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <span className="absolute top-3 left-3 font-display text-[34px] font-bold text-white/40">{initials(name)}</span>
                    )}
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-[rgba(2,6,23,.65)] px-2.5 py-0.5 font-display text-sm font-bold text-slate-100 backdrop-blur-[8px]">#{i + 1}</span>
                    <span className="absolute right-2.5 bottom-2.5 rounded-full bg-[rgba(2,6,23,.65)] px-2.5 py-0.5 font-display text-sm font-semibold text-slate-100 backdrop-blur-[8px]">
                      <span className="text-star">★</span> {c.rate}
                    </span>
                  </div>
                  <div className="font-display text-[15px] leading-tight font-semibold text-balance">{name}</div>
                  <div className="text-xs text-muted">{[typeName(c.type, t), meta].filter(Boolean).join(" · ")}</div>
                  {c.author && <div className="truncate text-xs text-fg2">{c.author}</div>}
                </li>
              );
            })}
          </ol>
        )}

        <footer className="pt-4 text-center text-xs text-muted">{t("Сделано в Episodio")}</footer>
      </main>
    </div>
  );
}
