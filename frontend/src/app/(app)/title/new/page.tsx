"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TitleForm } from "@/components/TitleForm";
import { Skeleton } from "@/components/ui";
import { emptyDraft, useStore } from "@/lib/store";

function NewTitle() {
  const hydrated = useStore((s) => s.hydrated);
  const q = useSearchParams().get("t") ?? "";
  if (!hydrated) return <Skeleton className="mx-4 mt-6 h-[480px]" />;
  return <TitleForm initial={{ ...emptyDraft(), t: q }} />;
}

export default function NewTitlePage() {
  return (
    <Suspense fallback={null}>
      <NewTitle />
    </Suspense>
  );
}
