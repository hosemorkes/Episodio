import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicShowcase } from "@/components/PublicShowcase";
import { translate } from "@/lib/i18n-core";
import { fetchPublicShowcase, originFrom, publicHandle } from "@/lib/public-showcase";
import { describeView } from "@/lib/showcases";
import type { Lang } from "@/lib/types";

// Витрина меняется вместе с библиотекой и отключается в любой момент: кэширование страницы исключено
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ user: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
};

/** Одна загрузка на запрос: generateMetadata и страница получают одни и те же данные */
const load = cache((user: string, slug: string) => (user === publicHandle() ? fetchPublicShowcase(user, slug) : Promise.resolve(null)));

const langOf = (lang?: string): Lang => (lang === "en" ? "en" : "ru");

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { user, slug } = await params;
  const lang = langOf((await searchParams).lang);
  const t = (ru: string) => translate(lang, ru);
  const view = await load(user, slug);
  if (!view) return { title: t("Витрина не найдена"), robots: { index: false, follow: false } };

  const h = await headers();
  const origin = originFrom((name) => h.get(name));
  const description = describeView(view, t, lang);
  const poster = view.cards.find((c) => c.img)?.img;
  const image = poster ? (poster.startsWith("/") ? `${origin}${poster}` : poster) : undefined;

  return {
    title: view.title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Episodio",
      title: view.title,
      description,
      url: `${origin}/u/${user}/${slug}`,
      locale: lang === "en" ? "en_US" : "ru_RU",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: "summary", title: view.title, description, images: image ? [image] : undefined },
  };
}

export default async function PublicShowcasePage({ params, searchParams }: Props) {
  const { user, slug } = await params;
  const lang = langOf((await searchParams).lang);
  const view = await load(user, slug);
  if (!view) notFound();
  return <PublicShowcase view={view} handle={user} lang={lang} />;
}
