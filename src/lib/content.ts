import "server-only";
import { cache } from "react";
import type { Keywords } from "@/lib/category-guess";
import { rankByUse, shownNow, type QuickStart, type QuickStartInput } from "@/lib/content-rules";
import { DbError } from "@/lib/db/deals";
import type { CategoryId } from "@/lib/engine";
import { liveCategories } from "@/lib/orgs";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Content Ops edits without a deploy (docs/decisions.md 2026-11-16 "From the database"):
 * quick starts (`quick_starts`) and the search words that guess a task's kind (`category_keywords`).
 */

interface QuickStartRow {
  id: string;
  kind: QuickStart["kind"];
  category: CategoryId;
  title_mn: string;
  title_en: string;
  months: number[];
  sort: number;
  active: boolean;
}

const fromRow = (r: QuickStartRow): QuickStart => ({
  id: r.id,
  kind: r.kind,
  category: r.category,
  titleMn: r.title_mn,
  titleEn: r.title_en,
  months: (r.months ?? []).map(Number),
  sort: Number(r.sort),
  active: r.active,
});

/** Every quick start (Ops sees inactive ones too). Once per request. */
export const allQuickStarts = cache(async (): Promise<QuickStart[]> => {
  const { data, error } = await createAdminClient().from("quick_starts").select("*").order("kind").order("sort").returns<QuickStartRow[]>();
  if (error) throw new DbError(error);
  return (data ?? []).map(fromRow);
});

/** How often each title was posted in the last 30 days (lower-cased title → count). */
const recentTitleUses = cache(async (): Promise<Map<string, number>> => {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await createAdminClient()
    .from("deals")
    .select("title")
    .eq("type", "errand")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000)
    .returns<{ title: string }[]>();
  const uses = new Map<string, number>();
  for (const r of data ?? []) {
    const k = r.title.trim().toLowerCase();
    uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  return uses;
});

/** The popular chips: what's on now, most posted first. Empty (not an error page) if the read fails. */
export async function popularStarts(now = Date.now(), limit = 6): Promise<QuickStart[]> {
  try {
    const [list, uses, live] = await Promise.all([allQuickStarts(), recentTitleUses(), liveCategories()]);
    return rankByUse(shownNow(list, "popular", now).filter((q) => live.includes(q.category)), uses).slice(0, limit);
  } catch (e) {
    console.error("quick starts failed", e);
    return [];
  }
}

export async function seasonalStarts(now = Date.now(), limit = 8): Promise<QuickStart[]> {
  try {
    const [list, live] = await Promise.all([allQuickStarts(), liveCategories()]);
    return shownNow(list, "seasonal", now).filter((q) => live.includes(q.category)).slice(0, limit);
  } catch (e) {
    console.error("quick starts failed", e);
    return [];
  }
}

/** Ops only (the caller checks and validates). */
export async function saveQuickStart(opsId: string, q: QuickStartInput): Promise<void> {
  const db = createAdminClient();
  const row = {
    kind: q.kind,
    category: q.category,
    title_mn: q.titleMn,
    title_en: q.titleEn,
    months: q.months,
    sort: q.sort,
    active: q.active,
    updated_at: new Date().toISOString(),
    updated_by: opsId,
  };
  if (q.id) {
    await db.from("quick_starts").update(row).eq("id", q.id).throwOnError();
  } else {
    await db.from("quick_starts").insert(row).throwOnError();
  }
  await audit(opsId, q.id ? "quick_start.update" : "quick_start.create", q.id, { title: q.titleMn, active: q.active });
}

export async function deleteQuickStart(opsId: string, id: string): Promise<void> {
  await createAdminClient().from("quick_starts").delete().eq("id", id).throwOnError();
  await audit(opsId, "quick_start.delete", id);
}

/* ---------- search words → kind of task ---------- */

export const loadKeywords = cache(async (): Promise<Keywords> => {
  const { data, error } = await createAdminClient().from("category_keywords").select("category, word").order("created_at").order("word").limit(2000).returns<{ category: CategoryId; word: string }[]>();
  if (error) {
    console.error("category keywords failed", error.message);
    return {}; // no guess: the person picks the kind themselves
  }
  const out: Partial<Record<CategoryId, string[]>> = {};
  for (const r of data ?? []) (out[r.category] ??= []).push(r.word);
  return out;
});

/** Replace one kind's words (Ops only; the caller validates). */
export async function saveKeywords(opsId: string, category: CategoryId, words: string[]): Promise<void> {
  const db = createAdminClient();
  const before = (await loadKeywords())[category] ?? [];
  const removed = before.filter((w) => !words.includes(w));
  const added = words.filter((w) => !before.includes(w));
  if (removed.length) await db.from("category_keywords").delete().eq("category", category).in("word", removed).throwOnError();
  if (added.length) await db.from("category_keywords").insert(added.map((word) => ({ category, word }))).throwOnError();
  await audit(opsId, "keywords.update", category, { added, removed });
}
