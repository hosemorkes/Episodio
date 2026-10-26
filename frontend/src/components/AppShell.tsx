"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { BottomNav } from "./BottomNav";
import { CommandPalette } from "./CommandPalette";
import { Toast } from "./Toast";

/** Оболочка приложения: фон, нижний таб-бар, палитра Ctrl+K, toast */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const setPalOpen = useStore((s) => s.setPalOpen);
  const ensureLoaded = useStore((s) => s.ensureLoaded);
  const loadError = useStore((s) => s.loadError);
  const hydrated = useStore((s) => s.hydrated);
  // Страницы деталей и редактирования — без общей обёртки <main>, но с таб-баром
  const fullscreen = pathname.startsWith("/title");

  // Данные загружаются, как только оболочка открыта (в том числе сразу после входа, без перезагрузки страницы)
  useEffect(() => ensureLoaded(), [ensureLoaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalOpen(true);
      } else if (e.key === "Escape") {
        setPalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalOpen]);

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_500px_at_80%_-10%,color-mix(in_srgb,var(--acc)_12%,transparent),transparent)] text-fg">
      {fullscreen ? (
        <>
          {/* запас снизу, чтобы таб-бар не перекрывал кнопки формы */}
          <div className="pb-[calc(70px+env(safe-area-inset-bottom))]">{children}</div>
          <BottomNav />
        </>
      ) : (
        <>
          <main className="px-4 pt-5 pb-[calc(110px+env(safe-area-inset-bottom))] min-[560px]:px-8 min-[560px]:pt-8">
            <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
              {hydrated && loadError && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm">
                  <span>
                    {t("Не удалось загрузить данные: ")}
                    {loadError}
                  </span>
                  <button type="button" onClick={ensureLoaded} className="flex h-11 items-center rounded-xl border border-slate-400/30 px-4 font-display text-sm font-semibold hover:border-acc">
                    {t("Повторить")}
                  </button>
                </div>
              )}
              {children}
            </div>
          </main>
          <BottomNav />
        </>
      )}
      <CommandPalette />
      <Toast />
    </div>
  );
}
