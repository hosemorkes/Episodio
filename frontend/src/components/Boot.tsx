"use client";

import { useEffect } from "react";
import { hydrateStore } from "@/lib/store";

/** Один раз на клиенте: подгружает данные, тему и язык; регистрирует service worker (PWA) */
export function Boot() {
  useEffect(() => {
    hydrateStore();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
