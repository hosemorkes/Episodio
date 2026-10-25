"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { Spinner } from "@/components/ui";
import { useStore } from "@/lib/store";

const T = {
  ru: { title: "С возвращением", sub: "Войдите в Episodio, чтобы продолжить просмотр", login: "Логин или email", loginPh: "name@example.com", password: "Пароль", show: "Показать пароль", showL: "Показать", hide: "Скрыть", remember: "Запомнить меня", forgot: "Забыли пароль?", btn: "Войти", busy: "Входим…", noAcc: "Нет аккаунта?", reg: "Создать", eLogin: "Введите логин", ePass: "Введите пароль", eShort: "Пароль не короче 4 символов", eNet: "Не удалось связаться с сервером", nForgot: "Ссылка для сброса пароля будет отправлена на почту", nReg: "Регистрация появится позже" },
  en: { title: "Welcome back", sub: "Sign in to Episodio to keep tracking", login: "Login or email", loginPh: "name@example.com", password: "Password", show: "Show password", showL: "Show", hide: "Hide", remember: "Remember me", forgot: "Forgot password?", btn: "Sign in", busy: "Signing in…", noAcc: "No account?", reg: "Create one", eLogin: "Enter your login", ePass: "Enter your password", eShort: "Password must be at least 4 characters", eNet: "Could not reach the server", nForgot: "A reset link will be sent to your email", nReg: "Sign-up is coming soon" },
};

// Ответы сервера приходят по-русски; для английского интерфейса переводим известные
const SERVER_EN: Record<string, string> = {
  "Неверный логин или пароль": "Wrong login or password",
  "Слишком много попыток, подождите минуту": "Too many attempts, wait a minute",
};

const field = "h-[52px] w-full rounded-[14px] bg-bg px-4 text-base font-medium outline-none focus:!border-acc border";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const lang = useStore((s) => s.lang);
  const t = T[lang];
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bad, setBad] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const say = (n: string) => {
    setNote(n);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 2500);
  };
  const fail = (msg: string) => {
    setError(msg);
    setBad(true);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const err = !login.trim() ? t.eLogin : !password ? t.ePass : password.length < 4 ? t.eShort : "";
    if (err) return fail(err);
    setBusy(true);
    setError("");
    setBad(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password, remember }),
      });
      if (!res.ok) {
        const detail: string = (await res.json().catch(() => null))?.detail ?? t.eNet;
        setBusy(false);
        return fail(lang === "en" ? (SERVER_EN[detail] ?? detail) : detail);
      }
      // next — только внутренние пути
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch {
      setBusy(false);
      fail(t.eNet);
    }
  };

  const badL = bad && !login.trim();
  const badP = bad && (!password || password.length < 4);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(800px_480px_at_80%_-10%,color-mix(in_srgb,var(--acc)_16%,transparent),transparent),radial-gradient(600px_400px_at_0%_110%,color-mix(in_srgb,var(--acc2)_12%,transparent),transparent)] px-4 py-[calc(24px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-[420px] animate-rise flex-col gap-7">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <div className="flex size-14 items-center justify-center rounded-[18px] border border-acc/50 bg-card shadow-[0_0_28px_color-mix(in_srgb,var(--acc)_35%,transparent)]">
            <LogoMark size={40} />
          </div>
          <div>
            <h1 className="font-display text-[30px] font-bold tracking-[-.03em]">{t.title}</h1>
            <div className="mt-1.5 text-[15px] text-muted">{t.sub}</div>
          </div>
        </div>

        <form onSubmit={submit} noValidate className={`flex flex-col gap-4 rounded-[26px] border border-line bg-glass p-6 shadow-card backdrop-blur-[16px] ${shaking ? "animate-shake" : ""}`}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">{t.login}</span>
            <input
              value={login}
              onChange={(e) => { setLogin(e.target.value); setError(""); setBad(false); }}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              placeholder={t.loginPh}
              aria-invalid={badL}
              className={`${field} ${badL ? "border-err" : "border-slate-400/30"}`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">{t.password}</span>
            <div className="relative">
              <input
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); setBad(false); }}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={badP}
                className={`${field} pr-16 ${badP ? "border-err" : "border-slate-400/30"}`}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={t.show}
                className="absolute top-1 right-1 flex h-11 min-w-[52px] items-center justify-center rounded-[10px] font-display text-[13px] font-semibold text-muted hover:text-acc"
              >
                {show ? t.hide : t.showL}
              </button>
            </div>
          </label>
          {error && (
            <div role="alert" className="-mt-1.5 text-[13px] text-err">
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" role="checkbox" aria-checked={remember} onClick={() => setRemember((r) => !r)} className="flex min-h-11 items-center gap-2.5 text-sm text-fg2">
              <span className={`flex size-[22px] items-center justify-center rounded-[7px] border-[1.5px] font-display text-sm font-bold text-onacc transition-all ${remember ? "border-acc bg-acc" : "border-slate-400/50"}`}>{remember ? "✓" : ""}</span>
              {t.remember}
            </button>
            <a href="#" onClick={(e) => { e.preventDefault(); say(t.nForgot); }} className="flex min-h-11 items-center text-sm no-underline">
              {t.forgot}
            </a>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="flex h-[54px] items-center justify-center gap-2.5 rounded-2xl bg-acc font-display text-base font-semibold text-onacc shadow-[0_0_24px_color-mix(in_srgb,var(--acc)_40%,transparent)] transition-shadow hover:shadow-[0_0_34px_color-mix(in_srgb,var(--acc)_65%,transparent)]"
          >
            {busy && <Spinner className="size-[18px]" />}
            {busy ? t.busy : t.btn}
          </button>
        </form>

        <div className="flex justify-center gap-2 text-sm text-muted">
          {t.noAcc}
          <a href="#" onClick={(e) => { e.preventDefault(); say(t.nReg); }} className="font-semibold no-underline">
            {t.reg}
          </a>
        </div>
        {note && <div className="self-center rounded-xl border border-acc/40 bg-glass px-4 py-2.5 text-[13px] text-fg2">{note}</div>}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
