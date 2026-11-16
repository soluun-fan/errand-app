import type { CategoryId } from "@/lib/engine";

/**
 * Guess the kind of task from what someone typed in search ("буйдан зөөх" → carry), so posting
 * can skip the "what kind?" step (PleaseHelp-style "related task"). Pure and tested; when unsure
 * it returns null and the person picks. The words live in the `category_keywords` table (Ops
 * edits them at /ops/content); `loadKeywords()` in content.ts reads them.
 *
 * A word matches the start of a typed word ("зөө" → "зөөх"); words of 1–2 letters must match a
 * whole word ("эм" is medicine, not "эмээ"); words with a space match as a phrase.
 */
export type Keywords = Partial<Record<CategoryId, readonly string[]>>;

/** Order matters on ties: the more specific kinds first (a "deliver documents" isn't shopping). */
const ORDER: readonly CategoryId[] = ["carry", "queue", "repair", "deliver", "shop"];

export function guessCategory(text: string | null | undefined, keywords: Keywords): CategoryId | null {
  const s = (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (s.length < 3) return null;
  const words = s.split(" ");
  const padded = ` ${s} `;
  const hit = (k: string) => {
    const w = k.toLowerCase().trim();
    if (!w) return false;
    if (w.includes(" ")) return padded.includes(` ${w}`);
    return w.length <= 2 ? words.includes(w) : words.some((x) => x.startsWith(w));
  };
  let best: CategoryId | null = null;
  let bestHits = 0;
  for (const cat of ORDER) {
    const hits = (keywords[cat] ?? []).filter(hit).length;
    if (hits > bestHits) {
      best = cat;
      bestHits = hits;
    }
  }
  return best;
}
