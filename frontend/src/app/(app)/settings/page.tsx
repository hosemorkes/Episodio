"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Block } from "@/components/ui";
import { ApiError, downloadExport, type ExportFormat } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { exportRows } from "@/lib/rules";
import { useStore } from "@/lib/store";
import type { Lang, Theme } from "@/lib/types";
import { useMe } from "@/lib/useMe";

const THEMES: [Theme, string, string, string, string, string][] = [
  ["dark", "Nordic Twilight", "Тёмная", "#0F172A", "#1E293B", "#2DD4BF"],
  ["light", "Nordic Frost", "Светлая", "#F8FAFC", "#FFFFFF", "#0F766E"],
];
const LANGS: [Lang, string][] = [["ru", "Русский"], ["en", "English"]];

const stamp = () => new Date().toISOString().slice(0, 10);

function download(name: string, mime: string, content: string | Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(typeof content === "string" ? new Blob([content], { type: `${mime};charset=utf-8` }) : content);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export default function SettingsPage() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const login = useMe();
  const { theme, setTheme, setLang, items, log, savedAt, markBackup, restore, say } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const saved = () => say(t("Файл сохранён"));

  const saveDb = () => {
    download(`episodio-backup-${stamp()}.json`, "application/json", JSON.stringify({ app: "Episodio", v: 1, savedAt: new Date().toISOString(), items, log }, null, 2));
    markBackup();
    say(t("База сохранена"));
  };
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  /** Excel и JSON собирает сервер (GET /export): весь список из базы, а не только загруженная страница */
  const exportFromServer = async (format: ExportFormat) => {
    if (exporting) return;
    setExporting(format);
    try {
      const { blob, filename } = await downloadExport(format);
      download(filename, format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json", blob);
      saved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/login?next=/settings");
        return;
      }
      say(e instanceof ApiError ? e.message : t("Не удалось выполнить действие"));
    } finally {
      setExporting(null);
    }
  };
  const exportTxt = () => {
    const { head, body } = exportRows(items, t);
    const text = `Episodio · ${t("Тайтлов: ")}${body.length}\n\n${body.map((r, i) => `${i + 1}. ${r.map((v, k) => (v === "" ? null : `${head[k]}: ${v}`)).filter(Boolean).join("\n   ")}`).join("\n\n")}\n`;
    download(`episodio-${stamp()}.txt`, "text/plain", text);
    saved();
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { restore(JSON.parse(String(r.result))); } catch { say(t("Файл не подошёл")); }
    };
    r.readAsText(f);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  const btn = "flex h-12 items-center rounded-[14px] border px-[18px] font-display text-sm font-semibold transition-colors hover:border-acc";

  return (
    <>
      <PageHeader kicker={t("Приложение")} title={t("Настройки")} />

      <Block className="flex flex-col gap-4">
        <div className="kicker">{t("ТЕМА")}</div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
          {THEMES.map(([k, name, sub, bg, card, acc]) => (
            <button
              key={k}
              type="button"
              aria-pressed={theme === k}
              onClick={() => setTheme(k)}
              className={`flex flex-col gap-3 rounded-[18px] border-2 p-3.5 text-left transition-colors hover:border-acc ${theme === k ? "border-acc" : "border-line"}`}
            >
              <div className="flex h-[72px] flex-col gap-1.5 rounded-xl border border-slate-400/30 p-2.5" style={{ background: bg }}>
                <div className="h-2.5 w-1/2 rounded-[5px]" style={{ background: acc }} />
                <div className="flex-1 rounded-lg" style={{ background: card }} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-base font-semibold">{name}</div>
                  <div className="text-[13px] text-muted">{t(sub)}</div>
                </div>
                <span className="font-display text-[13px] font-semibold text-acc">{theme === k ? t("Выбрана") : ""}</span>
              </div>
            </button>
          ))}
        </div>
      </Block>

      <Block className="flex flex-col gap-4">
        <div className="kicker">{t("ЯЗЫК")}</div>
        <div className="flex flex-wrap gap-3">
          {LANGS.map(([k, name]) => (
            <button
              key={k}
              type="button"
              aria-pressed={lang === k}
              onClick={() => setLang(k)}
              className={`flex h-[52px] min-w-40 items-center justify-between gap-3.5 rounded-2xl border-2 px-5 font-display text-base font-semibold transition-colors hover:border-acc ${lang === k ? "border-acc" : "border-line"}`}
            >
              {name}
              <span className="text-[13px] text-acc">{lang === k ? t("Выбрана") : ""}</span>
            </button>
          ))}
        </div>
      </Block>

      <Block className="flex flex-col gap-4">
        <div className="kicker">{t("ДАННЫЕ")}</div>
        <div className="text-[13px] text-muted">
          {savedAt ? t("Последняя копия: ") + new Date(savedAt).toLocaleString(lang === "en" ? "en-GB" : "ru-RU") : t("Копия ещё не сохранялась")}
        </div>
        <div className="text-[13px] font-semibold">{t("Резервная копия")}</div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pick} />
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={saveDb} className={`${btn} border-acc bg-acc text-onacc`}>{t("Сохранить базу данных")}</button>
          <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} border-slate-400/30`}>{t("Восстановить базу данных из файла")}</button>
        </div>
        <div className="text-[13px] font-semibold">{t("Экспорт")}</div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => void exportFromServer("xlsx")} disabled={!!exporting} className={`${btn} border-slate-400/30 disabled:opacity-60`}>{exporting === "xlsx" ? t("Готовлю файл…") : t("Экспорт в Excel")}</button>
          <button type="button" onClick={exportTxt} className={`${btn} border-slate-400/30`}>{t("Экспорт в TXT")}</button>
          <button type="button" onClick={() => void exportFromServer("json")} disabled={!!exporting} className={`${btn} border-slate-400/30 disabled:opacity-60`}>{exporting === "json" ? t("Готовлю файл…") : t("Экспорт в JSON")}</button>
        </div>
        <div className="text-xs text-muted">{t("Excel и TXT для восстановления не подходят.")}</div>
      </Block>

      <Block className="flex flex-col gap-3.5">
        <div className="kicker">{t("АККАУНТ")}</div>
        <div className="text-[15px]">
          {t("Вы вошли как ")}
          {login ?? "—"}
        </div>
        <button type="button" onClick={logout} className="flex h-12 items-center self-start rounded-[14px] border border-red-400/50 px-5 font-display text-sm font-semibold text-err hover:bg-red-400/10">
          {t("Выйти")}
        </button>
      </Block>
    </>
  );
}
