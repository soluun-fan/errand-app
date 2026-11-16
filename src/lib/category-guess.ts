import type { CategoryId } from "@/lib/engine";

/**
 * Guess the kind of task from what someone typed in search ("буйдан зөөх" → carry), so posting
 * can skip the "what kind?" step (PleaseHelp-style "related task"). Pure and tested; when unsure
 * it returns null and the person picks. Word stems, Mongolian first, a few English.
 */
const WORDS: Record<Exclude<CategoryId, "other">, readonly string[]> = {
  carry: ["зөө", "нүү", "буйдан", "диван", "хөргөгч", "тавилга", "шүүгээ", "ор ", "угаалгын машин", "ачаа", "өргө", "move", "sofa", "fridge", "furniture", "carry"],
  queue: ["дараалал", "зогсо", "бүртгүүл", "паспорт", "үнэмлэх", "дугаар ав", "queue", "line up"],
  repair: ["засах", "засвар", "цорго", "гэрэл", "чийдэн", "угсар", "суурилуул", "залгах", "өлгө", "fix", "repair", "assemble", "install", "tap", "light"],
  deliver: ["хүргэ", "илгээмж", "бичиг баримт", "баримт бичиг", "аваад", "авчирч өг", "шуудан", "deliver", "parcel", "document"],
  shop: ["дэлгүүр", "хүнс", "сүү", "талх", "супермаркет", "номин", "emart", "имарт", "худалдаж", "авчр", "эм ", "эмийн сан", "grocer", "shop", "buy", "pharmacy"],
};

/** Order matters on ties: the more specific kinds first (a "deliver documents" isn't shopping). */
const ORDER = ["carry", "queue", "repair", "deliver", "shop"] as const;

export function guessCategory(text: string | null | undefined): CategoryId | null {
  const s = ` ${(text ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (s.trim().length < 3) return null;
  let best: CategoryId | null = null;
  let bestHits = 0;
  for (const cat of ORDER) {
    const hits = WORDS[cat].filter((w) => s.includes(w)).length;
    if (hits > bestHits) {
      best = cat;
      bestHits = hits;
    }
  }
  return best;
}
