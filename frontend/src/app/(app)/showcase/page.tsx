"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Block, GhostButton, Pill, PrimaryButton, Skeleton, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { hueOf } from "@/lib/api";
import { posterBg, TYPES, typeName } from "@/lib/rules";
import { defaultTitle, draftOf, MONTHS_FULL, MONTHS_SHORT, SHOWCASE_SIZES, sameDraft, sharePath, showcaseYears } from "@/lib/showcases";
import { useStore } from "@/lib/store";
import type { Showcase, ShowcaseDraft } from "@/lib/types";
import { useAccount } from "@/lib/useMe";
import { showcaseError, useShowcaseList, useShowcasePreview } from "@/lib/useShowcases";

const field = "h-11 w-full rounded-xl border border-slate-400/20 bg-bg px-3.5 text-[15px] font-medium outline-none focus:border-acc";

const newDraft = (): ShowcaseDraft => ({ title: "", type: "all", year: new Date().getFullYear(), month: null, max: 8 });

export default function ShowcasePage() {
  const t = useT();
  const say = useStore((s) => s.say);
  const handle = useAccount()?.handle ?? "me";
  const { list, setList, error, reload } = useShowcaseList();
  const [sel, setSel] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<ShowcaseDraft>(newDraft);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const picked = useRef(false);

  // После загрузки списка открывается первая витрина, а если их нет — форма новой
  useEffect(() => {
    if (!list || picked.current) return;
    picked.current = true;
    if (list.length) {
      setSel(list[0].id);
      setDraft(draftOf(list[0]));
    } else {
      setSel("new");
    }
  }, [list]);

  const current = typeof sel === "number" ? list?.find((s) => s.id === sel) : undefined;
  const fallbackTitle = defaultTitle(draft, t);
  const effective: ShowcaseDraft = { ...draft, title: draft.title.trim() || fallbackTitle };
  const dirty = !current || !sameDraft(effective, draftOf(current));
  const preview = useShowcasePreview(list ? effective : null);
  const years = showcaseYears();

  const set = <K extends keyof ShowcaseDraft>(k: K, v: ShowcaseDraft[K]) => {
    setConfirmDel(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const open = (s: Showcase | "new") => {
    setConfirmDel(false);
    if (s === "new") {
      setSel("new");
      setDraft(newDraft());
    } else {
      setSel(s.id);
      setDraft(draftOf(s));
    }
  };
  const replace = (s: Showcase) => setList((l) => (l ? l.map((x) => (x.id === s.id ? s : x)) : [s]));

  const urlOf = (s: Showcase) => `${window.location.origin}${sharePath(handle, s.slug)}`;
  const copy = async (s: Showcase) => {
    try {
      await navigator.clipboard.writeText(urlOf(s));
      say(t("Ссылка скопирована"));
    } catch {
      say(`${t("Скопируйте ссылку: ")}${urlOf(s)}`); // буфер недоступен (например, не https)
    }
  };

  /** Сохраняет черновик: создаёт витрину или обновляет открытую. Ошибку показывает тостом и возвращает null */
  const save = async (): Promise<Showcase | null> => {
    try {
      let saved: Showcase;
      if (current) {
        saved = dirty ? await api.updateShowcase(current.id, effective) : current;
        replace(saved);
      } else {
        saved = await api.createShowcase(effective);
        setList((l) => [saved, ...(l ?? [])]);
        setSel(saved.id);
      }
      setDraft(draftOf(saved));
      return saved;
    } catch (e) {
      say(t(showcaseError(e)));
      return null;
    }
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onSave = () =>
    run(async () => {
      if (await save()) say(t("Витрина сохранена"));
    });

  const onShare = () =>
    run(async () => {
      const saved = await save();
      if (!saved) return;
      let shared = saved;
      if (!saved.isPublic) {
        try {
          shared = await api.updateShowcase(saved.id, { isPublic: true });
          replace(shared);
        } catch (e) {
          say(t(showcaseError(e)));
          return;
        }
      }
      await copy(shared);
    });

  const onUnshare = () =>
    run(async () => {
      if (!current) return;
      try {
        replace(await api.updateShowcase(current.id, { isPublic: false }));
        say(t("Витрина отключена: ссылка больше не открывается"));
      } catch (e) {
        say(t(showcaseError(e)));
      }
    });

  const onDelete = () => {
    if (!current) return;
    if (!confirmDel) return setConfirmDel(true);
    void run(async () => {
      try {
        await api.deleteShowcase(current.id);
        const rest = (list ?? []).filter((s) => s.id !== current.id);
        setList(rest);
        setConfirmDel(false);
        if (rest.length) open(rest[0]);
        else open("new");
        say(t("Витрина удалена"));
      } catch (e) {
        say(t(showcaseError(e)));
      }
    });
  };

  if (!list) {
    return (
      <>
        <PageHeader kicker={t("Публичная страница")} title={t("Витрина")} />
        {error ? (
          <Block className="flex flex-wrap items-center justify-between gap-3">
            <div role="alert" className="text-sm">{t(error)}</div>
            <GhostButton onClick={() => void reload()}>{t("Повторить")}</GhostButton>
          </Block>
        ) : (
          <Skeleton className="h-[320px] rounded-3xl" />
        )}
      </>
    );
  }

  const cards = preview.view?.cards ?? [];

  return (
    <>
      <PageHeader kicker={t("Публичная страница")} title={t("Витрина")} />

      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label={t("Мои витрины")}>
        {list.map((s) => (
          <Pill key={s.id} on={sel === s.id} onClick={() => open(s)} className="gap-2">
            {s.title}
            <span className={`size-2 rounded-full ${s.isPublic ? "bg-acc" : "bg-slate-400/50"}`} title={s.isPublic ? t("Публичная") : t("Скрыта")} />
          </Pill>
        ))}
        <Pill on={sel === "new"} onClick={() => open("new")} className="border-dashed">
          {t("+ Новая витрина")}
        </Pill>
      </div>

      <div className="flex flex-col gap-[18px] rounded-[28px] border border-acc/30 bg-card bg-[radial-gradient(600px_300px_at_20%_0%,color-mix(in_srgb,var(--acc)_22%,transparent),transparent)] p-[22px] min-[560px]:p-9">
        {current && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`rounded-full px-3 py-1 font-display text-xs font-semibold ${current.isPublic ? "bg-acc/15 text-acc" : "bg-slate-400/15 text-muted"}`}>
              {current.isPublic ? t("Публичная") : t("Скрыта")}
            </span>
            <span className="font-display text-xs font-semibold tracking-[.06em] break-all text-muted">{sharePath(handle, current.slug)}</span>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{t("Название")}</span>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder={fallbackTitle} maxLength={120} className={field} />
        </label>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{t("Тип")}</span>
            <div className="flex gap-2 overflow-x-auto">
              <Pill on={draft.type === "all"} onClick={() => set("type", "all")}>{t("Все")}</Pill>
              {TYPES.map(([k, n]) => (
                <Pill key={k} on={draft.type === k} onClick={() => set("type", k)}>
                  {t(n)}
                </Pill>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{t("Год завершения")}</span>
            <div className="flex gap-2 overflow-x-auto">
              <Pill on={draft.year === null} onClick={() => setDraft((d) => ({ ...d, year: null, month: null }))}>{t("Всё время")}</Pill>
              {years.map((y) => (
                <Pill key={y} on={draft.year === y} onClick={() => set("year", y)}>
                  {y}
                </Pill>
              ))}
            </div>
          </div>
          {draft.year !== null && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">{t("Месяц")}</span>
              <div className="flex gap-2 overflow-x-auto">
                <Pill on={draft.month === null} onClick={() => set("month", null)}>{t("Весь год")}</Pill>
                {MONTHS_SHORT.map((m, i) => (
                  <Pill key={m} on={draft.month === i + 1} onClick={() => set("month", i + 1)} title={t(MONTHS_FULL[i])}>
                    {t(m)}
                  </Pill>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{t("Мест в топе")}</span>
            <div className="flex gap-2 overflow-x-auto">
              {SHOWCASE_SIZES.map((n) => (
                <Pill key={n} on={draft.max === n} onClick={() => set("max", n)}>
                  {n}
                </Pill>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3" aria-busy={preview.busy}>
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            {t("Предпросмотр")}
            {preview.busy && <Spinner className="border-acc/30 border-t-acc" />}
          </div>
          {preview.error && <div role="alert" className="rounded-2xl border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm">{t(preview.error)}</div>}
          {!preview.error && preview.view && !cards.length && (
            <div className="py-9 text-center text-sm text-muted">
              {t("Нет записей за этот период. В топ попадают просмотренные тайтлы с оценкой и датой завершения.")}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {cards.map((c, i) => (
                <motion.div
                  key={`${c.t}-${c.y}-${i}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: Math.min(i, 8) * 0.04 }}
                  style={{ background: posterBg(c.img, hueOf(i + 1)) }}
                  className="relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-2xl p-3"
                >
                  <span className="font-display text-2xl font-bold text-white/70 drop-shadow">#{i + 1}</span>
                  <div className="rounded-xl bg-[rgba(2,6,23,.6)] p-2 backdrop-blur-[6px]">
                    <div className="font-display text-sm leading-tight font-semibold text-slate-100">{c.t}</div>
                    <div className="mt-0.5 text-xs text-slate-300">
                      <span className="text-star">★</span> {c.rate} / 10 · {typeName(c.type, t)}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <PrimaryButton onClick={onShare} disabled={busy} className="disabled:opacity-60">
            {busy && <Spinner />}
            {current?.isPublic && !dirty ? t("Скопировать ссылку") : t("Поделиться")}
          </PrimaryButton>
          <GhostButton onClick={onSave} disabled={busy || (!!current && !dirty)} className="disabled:opacity-50">
            {current ? t("Сохранить") : t("Создать")}
          </GhostButton>
          {current?.isPublic && (
            <>
              <a
                href={sharePath(handle, current.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center rounded-[14px] border border-slate-400/25 px-[18px] font-display text-sm font-semibold text-fg no-underline transition-colors hover:border-acc hover:text-fg"
              >
                {t("Открыть")} ↗
              </a>
              <GhostButton onClick={onUnshare} disabled={busy}>{t("Отключить")}</GhostButton>
            </>
          )}
          {current && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="ml-auto flex h-11 items-center rounded-[14px] px-4 font-display text-sm font-semibold text-pink-500 hover:bg-pink-400/10"
            >
              {confirmDel ? t("Точно удалить?") : t("Удалить")}
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          {t("Ссылку увидят все, у кого она есть: в ней название, постеры, оценки и годы. Заметки и прогресс не публикуются. «Отключить» закрывает ссылку.")}
        </p>
      </div>
    </>
  );
}
