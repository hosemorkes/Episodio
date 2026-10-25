import { CATALOG } from "./catalog-data";
import { findMine, recommend, type Tr } from "./rules";
import type { CatalogItem, Lang, Title } from "./types";

export type EpiAction = { label: string; kind: "plan"; catId: number } | { label: string; kind: "mark"; id: number };

export interface EpiReply {
  t: string;
  acts?: EpiAction[];
}

const POS = ["топ", "круто", "огонь", "отлич", "шедевр", "класс", "супер", "great", "awesome", "amazing", "love", "best"];
const NEG = ["слит", "скуч", "слаб", "затянут", "плох", "разочар", "weak", "boring", "bad", "slow", "rushed", "disappoint"];

/** Оценка, теги и текст рецензии из пары слов впечатлений (правила; в продакшене — LLM) */
export function draftReview(text: string, t: Tr) {
  const l = text.toLowerCase();
  const pos = POS.filter((w) => l.includes(w)).length;
  const neg = NEG.filter((w) => l.includes(w)).length;
  const tags: string[] = [];
  if (/концов|финал|ending|finale/.test(l)) tags.push(t("финал"));
  if (/сюжет|plot/.test(l)) tags.push(t("сюжет"));
  if (/анимац|animation/.test(l)) tags.push(t("анимация"));
  if (/темп|затянут|pace|slow/.test(l)) tags.push(t("темп"));
  if (!tags.length) tags.push(t("эмоции"));
  const rating = Math.max(3, Math.min(10, 7 + pos - neg * 1.5)).toFixed(1).replace(".0", "");
  const verdict = t("Сильная серия") + (neg ? t(", но развязка оставила вопросы: ожидания были выше.") : t(" с уверенной подачей."));
  return { rating, tags, verdict };
}

/** Ответ «Эпи» по ключевым словам. Интенты: рецензия, что вышло, досмотреть, посоветуй */
export function epiReply(text: string, items: Title[], lang: Lang, t: Tr, catalog: CatalogItem[] = CATALOG): EpiReply {
  const l = text.toLowerCase();
  const en = lang === "en";
  const nm = (x: { t: string; en?: string }) => (en && x.en ? x.en : x.t);

  if (/рецензи|отзыв|review|концов|финал|сюжет|серия|ending|finale|plot/.test(l)) {
    const r = draftReview(l, t);
    return { t: `${t("Готово, вот как это выглядит в виде рецензии.")}\n\n${t("Оценка: ")}${r.rating} / 10\n${r.verdict}\n${t("Теги: ")}${r.tags.join(", ")}` };
  }

  if (/вышл|нов|выход|релиз|new|release|out|air/.test(l)) {
    const air = catalog.filter((c) => c.s === "o" && findMine(items, c));
    const soon = catalog.filter((c) => c.s === "s");
    let out = air.length
      ? `${t("Выходит сейчас из ваших тайтлов:")}\n${air
          .map((c) => {
            const m = findMine(items, c)!;
            return `• ${nm(m)}${t(" — выходит, ваш прогресс ")}${m.ep} / ${m.tot}`;
          })
          .join("\n")}`
      : t("По вашим тайтлам пока тишина, новых серий нет.");
    if (soon.length) out += `\n\n${t("Скоро выйдет:")}\n${soon.map((c) => `• ${en ? c.en : c.t} (${c.y})${t(" — ожидается")}`).join("\n")}`;
    return { t: out, acts: soon.filter((c) => !findMine(items, c)).map((c) => ({ label: t("В планы: ") + (en ? c.en : c.t), kind: "plan" as const, catId: c.id })) };
  }

  if (/досмотр|продолж|смотрю|читаю|finish|continue|watching|left|progress/.test(l)) {
    const w = items
      .filter((x) => x.st === "watching" && x.ep < x.tot)
      .sort((a, b) => (a.tot - a.ep) / a.tot - (b.tot - b.ep) / b.tot)
      .slice(0, 4);
    if (!w.length) return { t: t("Всё досмотрено! Можно выбрать что-то новое: просто спросите, что посоветовать.") };
    return {
      t: `${t("Давайте добьём начатое. Ближе всего к финалу:")}\n${w.map((x) => `• ${nm(x)}${t(" — осталось ")}${x.tot - x.ep} (${Math.round((x.ep / x.tot) * 100)}%)`).join("\n")}`,
      acts: w.slice(0, 3).map((x) => ({ label: t("Отметить: ") + nm(x), kind: "mark" as const, id: x.id })),
    };
  }

  if (/посовет|рекоменд|что посмотр|что почитать|recommend|suggest|advice|something/.test(l)) {
    const rec = recommend(items, catalog, 3, true);
    if (!rec.length) return { t: t("Нет рекомендаций: каталог уже в вашей библиотеке.") };
    return {
      t: `${t("Вот что нашлось по вашим жанрам, надеюсь, что-то зацепит:")}\n${rec.map((c) => `• ${en ? c.en : c.t} (${c.y}) ★ ${c.r.toFixed(1)}${t(" — совпадают жанры: ")}${c.g.map(t).join(", ")}`).join("\n")}`,
      acts: rec.map((c) => ({ label: t("В планы: ") + (en ? c.en : c.t), kind: "plan" as const, catId: c.id })),
    };
  }

  return { t: t("Расскажу, что вышло, подскажу, что досмотреть, и посоветую новое. А ещё могу превратить ваши впечатления в рецензию: просто напишите пару слов.") };
}
