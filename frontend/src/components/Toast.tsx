"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "@/lib/store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed top-[calc(16px+env(safe-area-inset-top))] left-0 z-[60] flex w-full justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.2 }}
            className="rounded-[14px] border border-acc/40 bg-pop px-[18px] py-3 text-sm font-medium shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[14px]"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
