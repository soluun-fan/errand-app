import "server-only";
import { DbError } from "@/lib/db/deals";
import { LANGUAGES, type HelperBadges, type Language } from "@/lib/engine";
import { KYC_LEVEL_BACKGROUND } from "@/lib/kyc-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What a helper has for task conditions (docs/decisions.md 2026-11-18 "Task conditions"): a driver's
 * licence / own car checked by Ops, their on-time record, and the languages they speak. Legacy
 * criminal-record status remains available only to enforce old task conditions.
 */
export interface OnTime {
  jobs: number;
  onTime: number;
}

/** The on-time record shown on profiles: null = fewer than 3 booked jobs yet. */
export const onTimePct = (r: OnTime): number | null => (r.jobs < 3 ? null : Math.round((r.onTime / r.jobs) * 100));
/** Same rule as private.on_time_ok: no record yet, or ≥ 90 %. */
export const onTimeOk = (r: OnTime) => r.jobs < 3 || r.onTime * 10 >= r.jobs * 9;

const ubToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

export async function onTimeFor(helperId: string): Promise<OnTime> {
  const { data, error } = await createAdminClient().rpc("helper_on_time", { p_helper: helperId });
  if (error) throw new DbError(error);
  const row = (Array.isArray(data) ? data[0] : data) as { jobs?: number; on_time?: number } | null;
  return { jobs: Number(row?.jobs ?? 0), onTime: Number(row?.on_time ?? 0) };
}

export async function badgesForMany(helpers: { id: string; kycLevel: number }[]): Promise<Map<string, HelperBadges & { record: OnTime }>> {
  if (!helpers.length) return new Map();
  const db = createAdminClient();
  const ids = helpers.map((h) => h.id);
  const [{ data: badges }, { data: profiles }, records] = await Promise.all([
    db
      .from("helper_badges")
      .select("helper_id, kind, expires_on")
      .in("helper_id", ids)
      .eq("status", "approved")
      .returns<{ helper_id: string; kind: "driver" | "car"; expires_on: string | null }[]>()
      .throwOnError(),
    db.from("profiles").select("id, languages").in("id", ids).returns<{ id: string; languages: string[] | null }[]>().throwOnError(),
    Promise.all(ids.map(async (id) => [id, await onTimeFor(id)] as const)),
  ]);
  const today = ubToday();
  const rec = new Map(records);
  return new Map(
    helpers.map((h) => {
      const mine = (badges ?? []).filter((b) => b.helper_id === h.id && (!b.expires_on || b.expires_on >= today));
      const langs = ((profiles ?? []).find((p) => p.id === h.id)?.languages ?? []).filter((l): l is Language =>
        (LANGUAGES as readonly string[]).includes(l),
      );
      const record = rec.get(h.id) ?? { jobs: 0, onTime: 0 };
      return [
        h.id,
        {
          driver: mine.some((b) => b.kind === "driver"),
          car: mine.some((b) => b.kind === "car"),
          checked: h.kycLevel >= KYC_LEVEL_BACKGROUND,
          onTimeOk: onTimeOk(record),
          languages: langs,
          record,
        },
      ];
    }),
  );
}

export async function badgesFor(helperId: string, kycLevel: number): Promise<HelperBadges & { record: OnTime }> {
  return (await badgesForMany([{ id: helperId, kycLevel }])).get(helperId) as HelperBadges & { record: OnTime };
}

/** kyc levels for a list of helper ids (for badgesForMany). */
export async function kycLevels(ids: readonly string[]): Promise<{ id: string; kycLevel: number }[]> {
  if (!ids.length) return [];
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, kyc_level")
    .in("id", [...ids])
    .returns<{ id: string; kyc_level: number }[]>()
    .throwOnError();
  return (data ?? []).map((p) => ({ id: p.id, kycLevel: Number(p.kyc_level) }));
}

/* ---------- requesting and checking a driver's licence / car (Ops) ---------- */

export type BadgeKind = "driver" | "car";
export interface BadgeRow {
  id: string;
  helperId: string;
  kind: BadgeKind;
  status: "pending" | "approved" | "rejected" | "expired";
  info: Record<string, string>;
  expiresOn: string | null;
  reviewNote: string | null;
  createdAt: number;
}
interface Row {
  id: string;
  helper_id: string;
  kind: BadgeKind;
  status: BadgeRow["status"];
  info: Record<string, string> | null;
  expires_on: string | null;
  review_note: string | null;
  doc_path: string;
  created_at: string;
}
const toBadge = (r: Row): BadgeRow => ({
  id: r.id,
  helperId: r.helper_id,
  kind: r.kind,
  status: r.status,
  info: r.info ?? {},
  expiresOn: r.expires_on,
  reviewNote: r.review_note,
  createdAt: Date.parse(r.created_at),
});

export async function myBadges(helperId: string): Promise<BadgeRow[]> {
  const { data } = await createAdminClient()
    .from("helper_badges")
    .select("*")
    .eq("helper_id", helperId)
    .order("created_at", { ascending: false })
    .returns<Row[]>()
    .throwOnError();
  return (data ?? []).map(toBadge);
}

/** A helper asks Ops to check a licence / registration. "file" = the upload isn't theirs or missing. */
export async function requestBadge(
  helperId: string,
  kind: BadgeKind,
  info: Record<string, string>,
  expiresOn: string | null,
  docPath: string,
): Promise<"ok" | "file" | "duplicate"> {
  const { ownFileExists } = await import("@/lib/orgs");
  if (!(await ownFileExists(helperId, docPath))) return "file";
  const db = createAdminClient();
  // an expired one makes room for the renewal
  await db
    .from("helper_badges")
    .update({ status: "expired" })
    .eq("helper_id", helperId)
    .eq("kind", kind)
    .in("status", ["pending", "approved"])
    .lt("expires_on", ubToday())
    .throwOnError();
  const { error } = await db.from("helper_badges").insert({ helper_id: helperId, kind, info, expires_on: expiresOn, doc_path: docPath });
  if (error?.code === "23505") return "duplicate";
  if (error) throw new Error(error.message);
  return "ok";
}

export async function badgeQueue(): Promise<(BadgeRow & { helperName: string; docUrl: string | null })[]> {
  const { signedUrl } = await import("@/lib/orgs");
  const db = createAdminClient();
  const { data } = await db
    .from("helper_badges")
    .select("*")
    .eq("status", "pending")
    .order("created_at")
    .limit(50)
    .returns<Row[]>()
    .throwOnError();
  const rows = data ?? [];
  const names = rows.length
    ? ((
        await db
          .from("profiles")
          .select("id, name")
          .in(
            "id",
            rows.map((r) => r.helper_id),
          )
          .returns<{ id: string; name: string | null }[]>()
          .throwOnError()
      ).data ?? [])
    : [];
  return Promise.all(
    rows.map(async (r) => ({
      ...toBadge(r),
      helperName: names.find((n) => n.id === r.helper_id)?.name?.trim() || "—",
      docUrl: await signedUrl(r.doc_path),
    })),
  );
}

/** Ops approves or refuses (the caller checks admin and logs). False if it was already decided. */
export async function decideBadge(opsId: string, id: string, approve: boolean, note: string | null): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("helper_badges")
    .update({ status: approve ? "approved" : "rejected", review_note: note, reviewed_by: opsId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .throwOnError();
  return Boolean(data?.length);
}

/** The helper's own languages (self-declared). */
export async function setLanguages(helperId: string, langs: readonly string[]): Promise<void> {
  const clean = [...new Set(langs)].filter((l) => (LANGUAGES as readonly string[]).includes(l));
  await createAdminClient().from("profiles").update({ languages: clean }).eq("id", helperId).throwOnError();
}
