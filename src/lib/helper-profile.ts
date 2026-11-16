import "server-only";
import { categoryTrust, type CategoryId } from "@/lib/engine";
import { qualificationsForMany } from "@/lib/qualifications";
import { RATING_TAGS } from "@/lib/labels";
import { MAX_SAVED_HELPERS, cleanBio, maskName, median, publicNote, tagCounts } from "@/lib/profile-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public helper profiles (docs/decisions.md 2026-11-16): what a customer may see before choosing —
 * display name, badges, rating, jobs done, member since, categories, area (as the helper typed it),
 * reviews with the reviewer masked. Never phone, legal name, payout account or position.
 */
export interface HelperProfile {
  id: string;
  name: string;
  area: string | null;
  categories: CategoryId[];
  kycLevel: number;
  rating: number | null;
  ratingCount: number;
  completed: number;
  memberSince: number;
  /** The helper's own words (contacts masked when saved). */
  bio: string | null;
  /** "From 8,000₮" — what the helper says they usually start at; null = not given. */
  fromPrice: number | null;
}

/** The profile columns a customer may see (same as the trust card + the listing). */
const PUBLIC_COLS = "id, name, area, categories, kyc_level, rating_sum, rating_count, completed_count, created_at, bio, from_price";
interface PublicRow {
  id: string;
  name: string | null;
  area: string | null;
  categories: CategoryId[] | null;
  kyc_level: number;
  rating_sum: number;
  rating_count: number;
  completed_count: number;
  created_at: string;
  bio: string | null;
  from_price: number | null;
}

function toProfile(r: PublicRow): HelperProfile {
  const count = Number(r.rating_count);
  return {
    id: r.id,
    name: r.name?.trim() || "—",
    area: r.area?.trim() || null,
    categories: (r.categories ?? []).filter((c) => categoryTrust(c) === "open"),
    kycLevel: Number(r.kyc_level),
    rating: count > 0 ? Math.round((Number(r.rating_sum) / count) * 10) / 10 : null,
    ratingCount: count,
    completed: Number(r.completed_count),
    memberSince: Date.parse(r.created_at),
    bio: r.bio?.trim() || null,
    fromPrice: r.from_price === null ? null : Number(r.from_price),
  };
}

export interface PublicReview {
  stars: number;
  tags: string[];
  note: string | null;
  reviewer: string;
  category: CategoryId | null;
  at: number;
}

/** POSITIVE tags make the profile's highlights; every tag still shows on its own review. */
export const POSITIVE_TAGS = ["onTime", "careful", "friendly", "communication"] as const;

async function approvedHelper(id: string): Promise<{ profile: HelperProfile; suspended: boolean } | null> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select(`${PUBLIC_COLS}, role, helper_status, suspended_until`)
    .eq("id", id)
    .maybeSingle<PublicRow & { role: string; helper_status: string | null; suspended_until: string | null }>();
  if (!data || data.role !== "helper" || data.helper_status !== "approved") return null;
  const profile = toProfile(data);
  await enrichCategories([profile]);
  return { profile, suspended: Boolean(data.suspended_until && Date.parse(data.suspended_until) > Date.now()) };
}

/** An approved helper's public profile, or null. */
export async function helperProfile(id: string): Promise<HelperProfile | null> {
  return (await approvedHelper(id))?.profile ?? null;
}

/** The helper if customers can send them a request right now (approved, not suspended). */
export async function invitableHelper(id: string): Promise<HelperProfile | null> {
  const h = await approvedHelper(id);
  return h && !h.suspended ? h.profile : null;
}

/**
 * What this helper's finished jobs actually paid (the middle price of their last 30 completed
 * tasks), from real deals — shown next to their own "from" price. Null under 3 jobs.
 */
export async function typicalPrice(helperId: string): Promise<{ median: number; jobs: number } | null> {
  const { data } = await createAdminClient()
    .from("deals")
    .select("fee")
    .eq("helper_id", helperId)
    .eq("type", "errand")
    .eq("status", "released")
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<{ fee: number }[]>();
  const fees = (data ?? []).map((r) => Number(r.fee)).filter((n) => Number.isSafeInteger(n) && n > 0);
  const m = median(fees, 3);
  return m === null ? null : { median: m, jobs: fees.length };
}

/** The helper's own listing: intro and "from" price. Contacts in the intro are masked. */
export async function setListing(helperId: string, input: { bio: string | null; fromPrice: number | null }): Promise<{ masked: boolean }> {
  const { bio, masked } = cleanBio(input.bio);
  await createAdminClient()
    .from("profiles")
    .update({ bio, from_price: input.fromPrice })
    .eq("id", helperId)
    .eq("role", "helper")
    .throwOnError();
  return { masked };
}

export async function helperReviews(helperId: string, limit = 20): Promise<PublicReview[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("ratings")
    .select("deal_id, from_user_id, stars, tags, note, created_at")
    .eq("to_user_id", helperId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ deal_id: string; from_user_id: string; stars: number; tags: string[] | null; note: string | null; created_at: string }[]>();
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const [deals, people] = await Promise.all([
    db.from("deals").select("id, category").in("id", [...new Set(rows.map((r) => r.deal_id))]).returns<{ id: string; category: CategoryId | null }[]>(),
    db.from("profiles").select("id, name").in("id", [...new Set(rows.map((r) => r.from_user_id))]).returns<{ id: string; name: string | null }[]>(),
  ]);
  const cat = new Map((deals.data ?? []).map((d) => [d.id, d.category]));
  const who = new Map((people.data ?? []).map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    stars: Number(r.stars),
    tags: (r.tags ?? []).filter((x) => (RATING_TAGS as readonly string[]).includes(x)),
    note: publicNote(r.note),
    reviewer: maskName(who.get(r.from_user_id)),
    category: cat.get(r.deal_id) ?? null,
    at: Date.parse(r.created_at),
  }));
}

/** Highlights: positive tags given at least twice, most frequent first. */
export async function helperHighlights(helperId: string): Promise<{ tag: string; n: number }[]> {
  const { data } = await createAdminClient().from("ratings").select("tags").eq("to_user_id", helperId).limit(500).returns<{ tags: string[] | null }[]>();
  return tagCounts((data ?? []).map((r) => r.tags ?? []), POSITIVE_TAGS, 2);
}

/* ---------- directory (browse helpers, Unegui-style) ---------- */

export type HelperSort = "rating" | "jobs" | "new";

/** Approved, not-suspended helpers for browsing; optionally one category or a given id list (saved). */
export async function helperDirectory(opts: { category?: CategoryId; sort?: HelperSort; ids?: string[]; limit?: number } = {}): Promise<HelperProfile[]> {
  let q = createAdminClient()
    .from("profiles")
    .select(`${PUBLIC_COLS}, suspended_until`)
    .eq("role", "helper")
    .eq("helper_status", "approved");
  if (opts.category) {
    if (categoryTrust(opts.category) === "open") q = q.contains("categories", [opts.category]);
    else {
      const { data, error } = await createAdminClient().rpc("qualified_helper_ids", { p_category: opts.category });
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((r: { helper_id: string }) => r.helper_id);
      if (!ids.length) return [];
      q = q.in("id", ids);
    }
  }
  if (opts.ids) q = q.in("id", opts.ids.length ? opts.ids : ["00000000-0000-0000-0000-000000000000"]);
  const order = opts.sort === "jobs" ? "completed_count" : opts.sort === "new" ? "created_at" : "rating_count";
  const { data } = await q.order(order, { ascending: false }).limit(opts.limit ?? 48).returns<(PublicRow & { suspended_until: string | null })[]>();
  const now = Date.now();
  const rows = (data ?? []).filter((r) => !r.suspended_until || Date.parse(r.suspended_until) < now).map(toProfile);
  await enrichCategories(rows);
  // "top rated": a few 5★ shouldn't beat many 4.9★ — prior of 4.5★ × 5 ratings (same as dispatch ranking)
  if (opts.sort !== "jobs" && opts.sort !== "new") {
    const score = (h: HelperProfile) => ((h.rating ?? 0) * h.ratingCount + 4.5 * 5) / (h.ratingCount + 5);
    rows.sort((a, b) => score(b) - score(a));
  }
  return rows;
}

async function enrichCategories(helpers: HelperProfile[]): Promise<void> {
  const qualifications = await qualificationsForMany(helpers);
  for (const h of helpers) h.categories = [...new Set([...h.categories, ...(qualifications.get(h.id) ?? []).map((q) => q.category)])];
}

export interface RecentReview extends PublicReview {
  helperId: string;
  helperName: string;
}

/** Latest reviews with a written note, across helpers (Home / landing "what customers say"). */
export async function recentReviews(limit = 4): Promise<RecentReview[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("ratings")
    .select("deal_id, from_user_id, to_user_id, stars, tags, note, created_at")
    .not("note", "is", null)
    .gte("stars", 4)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ deal_id: string; from_user_id: string; to_user_id: string; stars: number; tags: string[] | null; note: string | null; created_at: string }[]>();
  const rows = (data ?? []).filter((r) => publicNote(r.note));
  if (!rows.length) return [];
  const [deals, people] = await Promise.all([
    db.from("deals").select("id, category").in("id", rows.map((r) => r.deal_id)).returns<{ id: string; category: CategoryId | null }[]>(),
    db.from("profiles").select("id, name").in("id", [...new Set(rows.flatMap((r) => [r.from_user_id, r.to_user_id]))]).returns<{ id: string; name: string | null }[]>(),
  ]);
  const cat = new Map((deals.data ?? []).map((d) => [d.id, d.category]));
  const who = new Map((people.data ?? []).map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    stars: Number(r.stars),
    tags: (r.tags ?? []).filter((x) => (RATING_TAGS as readonly string[]).includes(x)),
    note: publicNote(r.note),
    reviewer: maskName(who.get(r.from_user_id)),
    category: cat.get(r.deal_id) ?? null,
    at: Date.parse(r.created_at),
    helperId: r.to_user_id,
    helperName: who.get(r.to_user_id)?.trim() || "—",
  }));
}

/* ---------- ♡ saved helpers ---------- */

export async function savedHelperIds(customerId: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("saved_helpers")
    .select("helper_id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_HELPERS)
    .returns<{ helper_id: string }[]>();
  return (data ?? []).map((r) => r.helper_id);
}

export async function isSaved(customerId: string, helperId: string): Promise<boolean> {
  const { count } = await createAdminClient()
    .from("saved_helpers")
    .select("helper_id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("helper_id", helperId);
  return (count ?? 0) > 0;
}

/** Save or un-save. Only approved helpers can be saved; at most MAX_SAVED_HELPERS. */
export async function setSaved(customerId: string, helperId: string, on: boolean): Promise<"ok" | "full" | "notHelper"> {
  const db = createAdminClient();
  if (!on) {
    await db.from("saved_helpers").delete().eq("customer_id", customerId).eq("helper_id", helperId).throwOnError();
    return "ok";
  }
  if (customerId === helperId || !(await helperProfile(helperId))) return "notHelper";
  if ((await savedHelperIds(customerId)).length >= MAX_SAVED_HELPERS) return "full";
  await db.from("saved_helpers").upsert({ customer_id: customerId, helper_id: helperId }, { onConflict: "customer_id,helper_id", ignoreDuplicates: true }).throwOnError();
  return "ok";
}
