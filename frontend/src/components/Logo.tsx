import { cx } from "./ui";

/** Фирменный значок: тёмная и светлая версии переключаются темой сайта (см. .only-dark / .only-light) */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex flex-none", className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-icon-dark.svg" alt="" width={size} height={size} className="only-dark" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-icon-light.svg" alt="" width={size} height={size} className="only-light" />
    </span>
  );
}
