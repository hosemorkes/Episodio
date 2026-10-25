"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { ALL_GENRES, hasSeasons, isReading, posterBg, TYPES, unitOf } from "@/lib/rules";
import { type TitleDraft, useStore } from "@/lib/store";
import { Pill, Spinner } from "./ui";

const input = "h-11 w-full rounded-xl border border-slate-400/20 bg-bg px-3.5 text-[15px] font-medium outline-none focus:border-acc";
const label = "text-xs text-muted";

/** Уменьшает загруженную картинку до 480px по ширине: dataURL должен помещаться в localStorage */
function readPoster(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("bad image"));
      img.onload = () => {
        const k = Math.min(1, 480 / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function validate(d: TitleDraft, t: (s: string) => string) {
  const errors: Partial<Record<keyof TitleDraft, string>> = {};
  const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
  const neg = t("Число не меньше нуля");
  if (!d.t.trim()) errors.t = t("Укажите название");
  if (n(d.y) < 0 || Number.isNaN(n(d.y))) errors.y = neg;
  if (n(d.ep) < 0 || Number.isNaN(n(d.ep))) errors.ep = neg;
  if (d.type !== "movie") {
    // Пустое «Всего» допустимо: число серий идущего сериала неизвестно
    if (d.tot.trim() !== "" && (n(d.tot) < 1 || Number.isNaN(n(d.tot)))) errors.tot = t("Всего не меньше 1");
    else if (!errors.ep && n(d.tot) > 0 && n(d.ep) > n(d.tot)) errors.ep = t("Больше, чем всего");
  }
  if (hasSeasons(d.type) && (n(d.se) < 0 || Number.isNaN(n(d.se)))) errors.se = neg;
  if (isReading(d.type) && (n(d.vol) < 0 || Number.isNaN(n(d.vol)))) errors.vol = neg;
  if (d.link.trim() && !/^https?:\/\//i.test(d.link.trim())) errors.link = t("Ссылка должна начинаться с http:// или https://");
  return errors;
}

export function TitleForm({ initial }: { initial: TitleDraft }) {
  const router = useRouter();
  const t = useT();
  const { saveTitle, deleteTitle, say } = useStore();
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [gi, setGi] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof TitleDraft>(k: K, v: TitleDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const errors = validate(d, t);
  const show = (k: keyof TitleDraft) => (tried ? errors[k] : undefined);
  const u = unitOf(d.type, t);
  const backLabel = d.id !== null ? t("← Назад к просмотру") : t("← Назад");
  const back = () => (d.id !== null ? router.push(`/title/${d.id}`) : window.history.length > 1 ? router.back() : router.push("/"));

  const addGenre = (raw: string) => {
    const n = raw.trim();
    if (!n) return;
    setD((p) => (p.g.some((x) => x.toLowerCase() === n.toLowerCase()) ? p : { ...p, g: [...p.g, n[0].toUpperCase() + n.slice(1)] }));
    setGi("");
  };

  const save = async () => {
    setTried(true);
    if (saving) return;
    if (Object.keys(errors).length) {
      say(Object.values(errors)[0]!);
      return;
    }
    setSaving(true);
    const id = await saveTitle(d);
    setSaving(false);
    if (id !== null) router.replace(`/title/${id}`);
  };

  const field = (k: keyof TitleDraft, text: string, type: "text" | "number" = "text", span = false) => (
    <label className={`flex flex-col gap-1.5 ${span ? "col-span-2" : ""}`}>
      <span className={label}>{text}</span>
      <input
        value={String(d[k] ?? "")}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        min={type === "number" ? 0 : undefined}
        onChange={(e) => set(k, e.target.value as never)}
        aria-invalid={!!show(k)}
        className={`${input} ${show(k) ? "border-err" : ""}`}
      />
      {show(k) && <span className="text-xs text-err">{show(k)}</span>}
    </label>
  );

  const unused = ALL_GENRES.filter((g) => !d.g.includes(g)).slice(0, 6);

  return (
    <div className="min-h-screen">
      <form
        onSubmit={(e) => { e.preventDefault(); save(); }}
        className="mx-auto flex max-w-[880px] flex-col gap-4 px-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(40px+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-display text-xl font-bold">{d.id !== null ? t("Редактировать тайтл") : t("Новый тайтл")}</div>
          <button type="button" onClick={back} className="flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-muted hover:bg-slate-400/10">
            {backLabel}
          </button>
        </div>

        <div className="flex items-center gap-3.5">
          <div style={{ background: posterBg(d.img, [210, 230]) }} className="h-[104px] w-[72px] flex-none rounded-xl border border-slate-400/20" />
          <div className="flex flex-col gap-2">
            <span className={label}>{t("Постер")}</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) readPoster(f).then((img) => set("img", img)).catch(() => say(t("Файл не подошёл")));
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-11 items-center rounded-xl border border-slate-400/25 px-4 font-display text-sm font-semibold hover:border-acc">
                {t("Загрузить")}
              </button>
              <button type="button" onClick={() => set("img", "")} className="flex h-11 items-center rounded-xl px-3.5 text-sm text-muted hover:bg-slate-400/10">
                {t("Убрать")}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{t("Тип")}</span>
          <div className="flex flex-wrap gap-2">
            {TYPES.map(([k, n]) => (
              <Pill key={k} on={d.type === k} onClick={() => set("type", k)}>
                {t(n)}
              </Pill>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field("t", t("Название"), "text", true)}
          {field("en", t("Название (English)"), "text", true)}
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className={label}>{t("Описание")}</span>
            <textarea
              value={d.desc}
              onChange={(e) => set("desc", e.target.value)}
              rows={3}
              className="w-full resize-y rounded-xl border border-slate-400/20 bg-bg px-3.5 py-3 text-[15px] font-medium outline-none focus:border-acc"
            />
          </label>
          {hasSeasons(d.type) && field("se", t("Сезон"), "number")}
          {field("y", t("Год выхода"), "number")}
          {d.type === "movie" ? field("ep", u.w, "number") : (
            <>
              {field("ep", u.w, "number")}
              {field("tot", u.t, "number")}
            </>
          )}
          {isReading(d.type) && field("vol", t("Том"), "number")}
          {field("c", t("Страна"), "text", true)}
          {field("author", t("Автор"), "text", true)}
          {field("tr", t("Озвучка / перевод"), "text", true)}
          {field("link", t("Ссылка на источник"), "text", true)}
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{t("Личный рейтинг, 1–10")}</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={d.rate === n}
                onClick={() => set("rate", d.rate === n ? 0 : n)}
                className={`flex size-11 items-center justify-center rounded-xl border font-display text-[15px] font-semibold hover:border-acc ${d.rate === n ? "border-acc bg-acc text-onacc" : "border-slate-400/20 bg-bg"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{t("Жанры")}</span>
          <div className="flex flex-wrap gap-2">
            {d.g.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set("g", d.g.filter((x) => x !== n))}
                className="flex h-9 items-center gap-2 rounded-full border border-acc/35 bg-acc/15 px-3.5 text-[13px] hover:bg-pink-400/20"
              >
                {t(n)} ✕
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={gi}
              onChange={(e) => setGi(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGenre(gi); } }}
              placeholder={t("Новый жанр")}
              aria-label={t("Новый жанр")}
              className={`${input} flex-1`}
            />
            <button type="button" onClick={() => addGenre(gi)} className="flex h-11 items-center rounded-xl border border-slate-400/25 px-4 font-display text-sm font-semibold hover:border-acc">
              {t("Добавить")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unused.map((n) => (
              <button key={n} type="button" onClick={() => addGenre(n)} className="flex h-8 items-center rounded-full border border-dashed border-slate-400/30 px-3 text-xs text-muted hover:border-acc hover:text-acc">
                + {t(n)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2.5">
          {d.id !== null && (
            <button
              type="button"
              onClick={() => {
                if (!confirmDel) return setConfirmDel(true);
                deleteTitle(d.id!);
                router.replace("/");
              }}
              className="flex h-11 items-center rounded-[14px] px-4 font-display text-sm font-semibold text-pink-500 hover:bg-pink-400/10"
            >
              {confirmDel ? t("Точно удалить?") : t("Удалить")}
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex h-11 min-w-[140px] items-center justify-center gap-2.5 rounded-[14px] bg-acc px-6 font-display text-[15px] font-semibold text-onacc shadow-[0_0_22px_color-mix(in_srgb,var(--acc)_45%,transparent)] transition-shadow hover:shadow-[0_0_32px_color-mix(in_srgb,var(--acc)_75%,transparent)]"
          >
            {saving && <Spinner />}
            {saving ? t("Сохраняю…") : t("Сохранить")}
          </button>
        </div>
      </form>
    </div>
  );
}
