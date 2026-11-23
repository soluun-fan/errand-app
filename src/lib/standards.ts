import "server-only";
import type { ErrandDeal } from "@/lib/engine";
import { getRules } from "@/lib/rules";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkStart, startPoint, type StartCheck } from "@/lib/standards-rules";

/** Server side of "start only at the place": the helper's last reported position vs the start pin. */
export async function startPositionCheck(helperId: string, deal: ErrandDeal, now = Date.now()): Promise<StartCheck> {
  const target = startPoint(deal);
  if (!target) return { ok: true };
  const [rules, { data }] = await Promise.all([
    getRules(),
    createAdminClient().from("helper_presence").select("lat, lng, updated_at").eq("user_id", helperId)
      .maybeSingle<{ lat: number | null; lng: number | null; updated_at: string }>(),
  ]);
  const pos = data?.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng, at: Date.parse(data.updated_at) } : null;
  return checkStart(target, pos, now, rules.arriveRadiusM, rules.positionMaxAgeSeconds);
}

/** Active marks per helper (not voided, inside the window) — for ranking and the record page. */
export async function activeMarks(helperIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!helperIds.length) return out;
  const rules = await getRules();
  const since = new Date(Date.now() - rules.marksWindowDays * 86_400_000).toISOString();
  const { data } = await createAdminClient().from("helper_marks").select("helper_id")
    .in("helper_id", helperIds).is("voided_at", null).gt("created_at", since).returns<{ helper_id: string }[]>().throwOnError();
  for (const m of data ?? []) out.set(m.helper_id, (out.get(m.helper_id) ?? 0) + 1);
  return out;
}

/** Helpers whose record is at the "ranked lower" step or above (marks in the Ops window). */
export async function rankLowerSet(helperIds: string[]): Promise<Set<string>> {
  if (!helperIds.length) return new Set();
  try {
    const [rules, marks] = await Promise.all([getRules(), activeMarks(helperIds)]);
    return new Set([...marks].filter(([, n]) => n >= rules.marksRankLower).map(([id]) => id));
  } catch (e) {
    console.error("marks lookup failed; ranking without them", e);
    return new Set();
  }
}

export interface MarkView {
  id: string;
  dealId: string;
  title: string;
  kind: "late" | "no_show";
  at: number;
  appealNote: string | null;
  voided: boolean;
}

interface MarkRow {
  id: string;
  deal_id: string;
  helper_id: string;
  kind: "late" | "no_show";
  created_at: string;
  appeal_note: string | null;
  voided_at: string | null;
  deals: { title: string } | null;
}

const toView = (m: MarkRow): MarkView => ({
  id: m.id, dealId: m.deal_id, title: m.deals?.title ?? "—", kind: m.kind, at: Date.parse(m.created_at), appealNote: m.appeal_note, voided: m.voided_at !== null,
});

/** The helper's own record: marks inside the window (voided ones shown as such), and the count that matters. */
export async function helperRecord(helperId: string): Promise<{ marks: MarkView[]; active: number; windowDays: number; pausedUntil: number | null }> {
  const rules = await getRules();
  const since = new Date(Date.now() - rules.marksWindowDays * 86_400_000).toISOString();
  const db = createAdminClient();
  const [{ data }, { data: prof }] = await Promise.all([
    db.from("helper_marks").select("id, deal_id, helper_id, kind, created_at, appeal_note, voided_at, deals(title)")
      .eq("helper_id", helperId).gt("created_at", since).order("created_at", { ascending: false }).returns<MarkRow[]>().throwOnError(),
    db.from("profiles").select("suspended_until").eq("id", helperId).maybeSingle<{ suspended_until: string | null }>(),
  ]);
  const marks = (data ?? []).map(toView);
  const until = prof?.suspended_until ? Date.parse(prof.suspended_until) : null;
  return { marks, active: marks.filter((m) => !m.voided).length, windowDays: rules.marksWindowDays, pausedUntil: until && until > Date.now() ? until : null };
}

/** The helper explains a mark (once); Ops sees it next to the mark. */
export async function appealMark(markId: string, helperId: string, note: string): Promise<boolean> {
  const { data } = await createAdminClient().from("helper_marks")
    .update({ appeal_note: note, appealed_at: new Date().toISOString() })
    .eq("id", markId).eq("helper_id", helperId).is("appeal_note", null).is("voided_at", null)
    .select("id").returns<{ id: string }[]>().throwOnError();
  return (data ?? []).length === 1;
}

export interface OpsMarkView extends MarkView { helperId: string; helperName: string; activeForHelper: number; pausedUntil: number | null }

/** Ops: recent marks (appealed first), with each helper's current count and pause. */
export async function opsMarks(): Promise<OpsMarkView[]> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await db.from("helper_marks").select("id, deal_id, helper_id, kind, created_at, appeal_note, voided_at, deals(title)")
    .gt("created_at", since).order("created_at", { ascending: false }).limit(200).returns<MarkRow[]>().throwOnError();
  const rows = data ?? [];
  const ids = [...new Set(rows.map((m) => m.helper_id))];
  const [counts, { data: profs }] = await Promise.all([
    activeMarks(ids),
    ids.length ? db.from("profiles").select("id, name, suspended_until").in("id", ids).returns<{ id: string; name: string | null; suspended_until: string | null }[]>() : Promise.resolve({ data: [] as { id: string; name: string | null; suspended_until: string | null }[] }),
  ]);
  const byId = new Map((profs ?? []).map((p) => [p.id, p]));
  return rows
    .map((m) => {
      const p = byId.get(m.helper_id);
      const until = p?.suspended_until ? Date.parse(p.suspended_until) : null;
      return { ...toView(m), helperId: m.helper_id, helperName: p?.name || "—", activeForHelper: counts.get(m.helper_id) ?? 0, pausedUntil: until && until > Date.now() ? until : null };
    })
    .sort((a, b) => Number(Boolean(b.appealNote) && !b.voided) - Number(Boolean(a.appealNote) && !a.voided) || b.at - a.at);
}

/** Ops voids a mark (appeal accepted, or the customer caused the delay). Logged. */
export async function voidMark(markId: string, opsId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("helper_marks")
    .update({ voided_at: new Date().toISOString(), voided_by: opsId }).eq("id", markId).is("voided_at", null)
    .select("helper_id").returns<{ helper_id: string }[]>().throwOnError();
  if (!data?.length) return false;
  await audit(opsId, "marks.void", data[0].helper_id, { markId });
  return true;
}

/** Ops lifts a helper's pause after reviewing their record. Logged. */
export async function liftPause(helperId: string, opsId: string): Promise<void> {
  await createAdminClient().from("profiles").update({ suspended_until: null }).eq("id", helperId).throwOnError();
  await audit(opsId, "marks.lift_pause", helperId, {});
}
