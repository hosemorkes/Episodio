"use client";

import { useEffect, useState } from "react";

/** Логин текущего пользователя из сессии (GET /api/auth/me) */
export function useMe() {
  const [login, setLogin] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setLogin(d?.login ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return login;
}
