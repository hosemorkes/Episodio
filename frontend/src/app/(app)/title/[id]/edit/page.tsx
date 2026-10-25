"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { TitleForm } from "@/components/TitleForm";
import { Skeleton } from "@/components/ui";
import { draftOf, useStore } from "@/lib/store";

export default function EditTitlePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const hydrated = useStore((s) => s.hydrated);
  const it = useStore((s) => s.items.find((x) => x.id === Number(id)));

  useEffect(() => {
    if (hydrated && !it) router.replace(`/title/${id}`);
  }, [hydrated, it, id, router]);

  if (!hydrated || !it) return <Skeleton className="mx-4 mt-6 h-[480px]" />;
  return <TitleForm key={it.id} initial={draftOf(it)} />;
}
