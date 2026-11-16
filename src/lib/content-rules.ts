import { z } from "zod";
import { CATEGORIES, DEFAULT_CONFIG, type CategoryId } from "@/lib/engine";
import type { Locale } from "@/i18n";

/**
 * Pure rules for the content Ops edits at /ops/content (docs/decisions.md 2026-11-16 "From the
 * database"): quick starts and the category search words. Tested; content.ts does the I/O.
 */
export interface QuickStart {
  id: string;
  kind: "popular" | "seasonal";
  category: CategoryId;
  titleMn: string;
  titleEn: string;
  /** Ulaanbaatar months 1–12 it shows in. */
  months: number[];
  sort: number;
  active: boolean;
}

export const qsTitle = (q: Pick<QuickStart, "titleMn" | "titleEn">, locale: Locale) => (locale === "en" ? q.titleEn : q.titleMn);

/** Month 1–12 in Ulaanbaatar (UTC+8, no DST). */
export const ubMonth = (ms: number) => new Date(ms + 8 * 3_600_000).getUTCMonth() + 1;

/** What shows now: active, this kind, this month, in Ops' order. */
export function shownNow(list: readonly QuickStart[], kind: QuickStart["kind"], now: number): QuickStart[] {
  const m = ubMonth(now);
  return list.filter((q) => q.active && q.kind === kind && q.months.includes(m)).sort((a, b) => a.sort - b.sort);
}

/**
 * "Popular" earns its name: the ones people actually posted most in the last weeks come first
 * (`uses`: lower-cased title → count); Ops' order breaks ties and covers a quiet start.
 */
export function rankByUse(list: readonly QuickStart[], uses: ReadonlyMap<string, number>): QuickStart[] {
  const n = (q: QuickStart) => (uses.get(q.titleMn.trim().toLowerCase()) ?? 0) + (uses.get(q.titleEn.trim().toLowerCase()) ?? 0);
  return [...list].sort((a, b) => n(b) - n(a) || a.sort - b.sort);
}

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];
const Title = z.string().trim().min(2).max(DEFAULT_CONFIG.titleMax);

export const QuickStartInput = z.object({
  id: z.string().uuid().nullable(),
  kind: z.enum(["popular", "seasonal"]),
  category: z.enum(CATEGORY_IDS),
  titleMn: Title,
  titleEn: Title,
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12).transform((m) => [...new Set(m)].sort((a, b) => a - b)),
  sort: z.number().int().min(-1000).max(1000),
  active: z.boolean(),
});
export type QuickStartInput = z.infer<typeof QuickStartInput>;

/** At most this many words per kind of task (keeps the guess fast and the list reviewable). */
export const MAX_KEYWORDS = 200;

/** Ops' textarea (one per line or comma-separated) → clean, unique, lower-case words; null if a word is too long. */
export function parseKeywords(text: string): string[] | null {
  const words = [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((w) => w.toLowerCase().replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
  if (words.some((w) => w.length < 2 || w.length > 40) || words.length > MAX_KEYWORDS) return null;
  return words;
}
