"use client";

import { useEffect, useState } from "react";

export interface Account {
  login: string;
  /** имя в публичных ссылках /u/<handle>/… */
  handle: string;
}

/** Текущий пользователь из сессии (GET /api/auth/me); null, пока ответа нет или сессии нет */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setAccount(d?.login ? { login: d.login, handle: d.handle ?? "me" } : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return account;
}

/** Логин текущего пользователя из сессии */
export function useMe() {
  return useAccount()?.login ?? null;
}
