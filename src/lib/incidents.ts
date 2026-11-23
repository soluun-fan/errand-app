import "server-only";
import type { Deal } from "@/lib/engine";
import { getRules } from "@/lib/rules";
import { INCIDENT_LOCATION_DAYS, REPORTS_PER_HOUR, SOS_REPING_FOR_MS, SOS_REPING_MS, needsReping, type IncidentKind, type Position } from "@/lib/incident-rules";
import { notify } from "@/lib/push";
import { adminIds, audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SOS and problem reports (docs/decisions.md 2026-11-15 "Safety pack"). Server-only data: the
 * caller has checked who is acting. The OTHER person on the task is never told about a report
 * or an SOS — if they are the danger, telling them could make it worse.
 */

/** The two people on a task. */
function parties(deal: Deal): string[] {
  return (deal.type === "errand" ? [deal.customerId, deal.helperId] : [deal.sellerId, deal.buyerId]).filter((x): x is string => Boolean(x));
}

export function isParty(deal: Deal, userId: string): boolean {
  return parties(deal).includes(userId);
}

function otherParty(deal: Deal, userId: string): string | null {
  return parties(deal).find((p) => p !== userId) ?? null;
}

async function alertOps(incidentId: string, sos: boolean, title: string): Promise<void> {
  await notify(await adminIds(), {
    title: sos ? "push.sosTitle" : "push.incidentTitle",
    body: sos ? "push.sosBody" : "push.incidentBody",
    params: { title },
    url: `/ops/incidents#${incidentId}`,
    tag: `incident-${incidentId}`,
  });
}

/**
 * SOS: one live record per person per task. Pressing again updates the position, counts the
 * press and alerts Ops again. Returns the incident id.
 */
export async function raiseSos(deal: Deal, reporterId: string, pos: Position | null): Promise<string> {
  const db = createAdminClient();
  const at = new Date().toISOString();
  const where = pos ? { lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy } : {};
  const { data: live } = await db
    .from("incidents")
    .select("id, alerts")
    .eq("deal_id", deal.id)
    .eq("reporter_id", reporterId)
    .eq("kind", "sos")
    .neq("status", "resolved")
    .maybeSingle<{ id: string; alerts: number }>();
  let id: string;
  if (live) {
    await db.from("incidents").update({ ...where, alerts: live.alerts + 1, last_alert_at: at, ops_pinged_at: at }).eq("id", live.id).throwOnError();
    id = live.id;
  } else {
    const { data, error } = await db
      .from("incidents")
      .insert({ deal_id: deal.id, reporter_id: reporterId, subject_id: otherParty(deal, reporterId), kind: "sos", ...where, ops_pinged_at: at })
      .select("id")
      .single<{ id: string }>();
    if (error?.code === "23505") return raiseSos(deal, reporterId, pos); // a parallel press created it
    if (error || !data) throw new Error(error?.message ?? "SOS insert failed");
    id = data.id;
  }
  await alertOps(id, true, deal.title);
  return id;
}

export type ReportResult = { ok: true } | { ok: false; reason: "limit" };

export async function reportIncident(deal: Deal, reporterId: string, kind: IncidentKind, note: string): Promise<ReportResult> {
  const db = createAdminClient();
  const { count } = await db
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", reporterId)
    .neq("kind", "sos")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= REPORTS_PER_HOUR) return { ok: false, reason: "limit" };
  const { data } = await db
    .from("incidents")
    .insert({ deal_id: deal.id, reporter_id: reporterId, subject_id: otherParty(deal, reporterId), kind, note })
    .select("id")
    .single<{ id: string }>()
    .throwOnError();
  if (data) await alertOps(data.id, false, deal.title);
  return { ok: true };
}

/** The viewer's live SOS on this task (to show "Our team has been alerted"), or null. */
export async function liveSos(dealId: string, reporterId: string): Promise<{ since: number; acknowledged: boolean } | null> {
  const { data } = await createAdminClient()
    .from("incidents")
    .select("created_at, status")
    .eq("deal_id", dealId)
    .eq("reporter_id", reporterId)
    .eq("kind", "sos")
    .neq("status", "resolved")
    .maybeSingle<{ created_at: string; status: string }>();
  return data ? { since: Date.parse(data.created_at), acknowledged: data.status === "acknowledged" } : null;
}

/* ---------- Ops ---------- */

export interface IncidentForOps {
  id: string;
  dealId: string;
  dealTitle: string;
  dealStatus: string;
  kind: IncidentKind;
  status: "open" | "acknowledged" | "resolved";
  note: string;
  reporter: { id: string; name: string; role: "customer" | "helper"; phone: string | null };
  subject: { id: string; name: string } | null;
  position: { lat: number; lng: number; accuracy: number | null } | null;
  alerts: number;
  lastAlertAt: number;
  createdAt: number;
  opsNote: string | null;
  handledBy: string | null;
}

interface IncidentRow {
  id: string;
  deal_id: string;
  reporter_id: string;
  subject_id: string | null;
  kind: IncidentKind;
  status: IncidentForOps["status"];
  note: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  alerts: number;
  last_alert_at: string;
  created_at: string;
  ops_note: string | null;
  handled_by: string | null;
}

/**
 * For /ops/incidents (admins only — the caller checks): everything unresolved, SOS first, then
 * the 20 most recently resolved. Includes the reporter's phone so Ops can call back after an SOS.
 */
export async function incidentQueue(): Promise<IncidentForOps[]> {
  const db = createAdminClient();
  const [live, done] = await Promise.all([
    db.from("incidents").select("*").neq("status", "resolved").order("created_at", { ascending: false }).limit(100).returns<IncidentRow[]>(),
    db.from("incidents").select("*").eq("status", "resolved").order("resolved_at", { ascending: false }).limit(20).returns<IncidentRow[]>(),
  ]);
  const rows = [...(live.data ?? []).sort((a, b) => Number(b.kind === "sos") - Number(a.kind === "sos")), ...(done.data ?? [])];
  if (rows.length === 0) return [];
  const people = [...new Set(rows.flatMap((r) => [r.reporter_id, r.subject_id, r.handled_by]).filter((x): x is string => Boolean(x)))];
  const deals = [...new Set(rows.map((r) => r.deal_id))];
  const [{ data: profs }, { data: ds }] = await Promise.all([
    db.from("profiles").select("id, name, phone").in("id", people).returns<{ id: string; name: string; phone: string | null }[]>(),
    db.from("deals").select("id, title, status, customer_id").in("id", deals).returns<{ id: string; title: string; status: string; customer_id: string | null }[]>(),
  ]);
  const p = new Map((profs ?? []).map((x) => [x.id, x]));
  const d = new Map((ds ?? []).map((x) => [x.id, x]));
  return rows.map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    dealTitle: d.get(r.deal_id)?.title ?? "—",
    dealStatus: d.get(r.deal_id)?.status ?? "",
    kind: r.kind,
    status: r.status,
    note: r.note,
    reporter: {
      id: r.reporter_id,
      name: p.get(r.reporter_id)?.name || "—",
      role: d.get(r.deal_id)?.customer_id === r.reporter_id ? "customer" : "helper",
      phone: p.get(r.reporter_id)?.phone ?? null,
    },
    subject: r.subject_id ? { id: r.subject_id, name: p.get(r.subject_id)?.name || "—" } : null,
    position: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng, accuracy: r.accuracy_m } : null,
    alerts: r.alerts,
    lastAlertAt: Date.parse(r.last_alert_at),
    createdAt: Date.parse(r.created_at),
    opsNote: r.ops_note,
    handledBy: r.handled_by ? (p.get(r.handled_by)?.name ?? "—") : null,
  }));
}

export async function openIncidentCounts(): Promise<{ open: number; sos: number }> {
  const db = createAdminClient();
  const [all, sos] = await Promise.all([
    db.from("incidents").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    db.from("incidents").select("id", { count: "exact", head: true }).neq("status", "resolved").eq("kind", "sos"),
  ]);
  return { open: all.count ?? 0, sos: sos.count ?? 0 };
}

/** "I'm on it": stops the reminder pushes. Returns false if it was already handled. */
export async function acknowledgeIncident(id: string, opsId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("incidents")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), handled_by: opsId })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .returns<{ id: string }[]>();
  if (!data?.length) return false;
  await audit(opsId, "incident.acknowledge", id);
  return true;
}

export async function resolveIncident(id: string, opsId: string, note: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("incidents")
    .update({ status: "resolved", ops_note: note, resolved_at: new Date().toISOString(), handled_by: opsId })
    .eq("id", id)
    .neq("status", "resolved")
    .select("id")
    .returns<{ id: string }[]>();
  if (!data?.length) return false;
  await audit(opsId, "incident.resolve", id, { note });
  return true;
}

/* ---------- background tick ---------- */

/** An SOS nobody acknowledged: push Ops again (every 2 min, for 30 min). Returns how many. */
export async function repingSos(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  // Ops settings (2026-11-22); built-in 2 / 30 min if the rules can't be read — an SOS reminder must never fail
  const rules = await getRules().catch(() => null);
  const everyMs = (rules?.sosRepingMinutes ?? SOS_REPING_MS / 60_000) * 60_000;
  const forMs = (rules?.sosRepingForMinutes ?? SOS_REPING_FOR_MS / 60_000) * 60_000;
  const { data } = await db
    .from("incidents")
    .select("id, deal_id, kind, status, created_at, ops_pinged_at, last_alert_at")
    .eq("kind", "sos")
    .eq("status", "open")
    .gte("created_at", new Date(now - forMs).toISOString())
    .returns<{ id: string; deal_id: string; kind: string; status: string; created_at: string; ops_pinged_at: string | null; last_alert_at: string }[]>();
  let n = 0;
  for (const r of data ?? []) {
    const lastPingAt = Math.max(Date.parse(r.last_alert_at), r.ops_pinged_at ? Date.parse(r.ops_pinged_at) : 0);
    if (!needsReping({ kind: r.kind, status: r.status, createdAt: Date.parse(r.created_at), lastPingAt }, now, everyMs, forMs)) continue;
    // ticks run one at a time (DB lease), so a plain update is enough to record the reminder
    const { data: still } = await db
      .from("incidents")
      .update({ ops_pinged_at: new Date(now).toISOString() })
      .eq("id", r.id)
      .eq("status", "open")
      .select("id")
      .returns<{ id: string }[]>();
    if (!still?.length) continue; // acknowledged meanwhile
    const { data: deal } = await db.from("deals").select("title").eq("id", r.deal_id).maybeSingle<{ title: string }>();
    await alertOps(r.id, true, deal?.title ?? "");
    n++;
  }
  return n;
}

/** Exact positions are personal data: dropped 30 days after the incident is resolved. */
export async function purgeIncidentLocations(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - INCIDENT_LOCATION_DAYS * 24 * 3_600_000).toISOString();
  const { data } = await createAdminClient()
    .from("incidents")
    .update({ lat: null, lng: null, accuracy_m: null, location_purged_at: new Date(now).toISOString() })
    .eq("status", "resolved")
    .lt("resolved_at", cutoff)
    .is("location_purged_at", null)
    .select("id")
    .returns<{ id: string }[]>();
  return data?.length ?? 0;
}
