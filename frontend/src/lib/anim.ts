"use client";

import { animate } from "framer-motion";
import { useEffect, useState } from "react";

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/** Доля прогресса элемента i при общем прогрессе p: элементы стартуют по очереди (stagger 0.07) */
export function staggered(p: number, i: number, step = 0.07, span = 0.6) {
  return easeOutCubic(Math.max(0, Math.min(1, (p - i * step) / span)));
}

/** Прогресс 0 → 1 за duration секунд после delay; перезапускается при каждом монтировании страницы */
export function useRunProgress(duration = 1.8, delay = 0.15) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setP(1);
      return;
    }
    setP(0);
    const controls = animate(0, 1, { duration, delay, ease: "linear", onUpdate: setP });
    return () => controls.stop();
  }, [duration, delay]);
  return p;
}
