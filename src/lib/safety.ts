import { toJson } from "@/lib/db/json";
import "server-only";
import { DbError } from "@/lib/db/deals";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Platform safety controls (docs/decisions.md 2026-11-15 "Safety pack"). One DB row Ops changes
 * from /ops/safety. The database enforces the pause and the money freeze itself (triggers), so
 * these helpers only give people a clear message before they hit that wall.
 */
export interface Controls {
  postingPaused: boolean;
  paymentsPaused: boolean;
  pauseNote: string | null;
  maxDealAmount: number;
  maxCustomerDaily: number;
  maxTotalHeld: number;
  maxOpenTasks: number;
  updatedAt: number;
}

interface ControlsRow {
  posting_paused: boolean;
  payments_paused: boolean;
  pause_note: string | null;
  max_deal_amount: number;
  max_customer_daily: number;
  max_total_held: number;
  max_open_tasks: number;
  updated_at: string;
}

export async function getControls(): Promise<Controls> {
  const { data, error } = await createAdminClient().from("platform_controls").select("*").single<ControlsRow>();
  if (error || !data) throw new DbError(error ?? { message: "platform_controls row missing" });
  return {
    postingPaused: data.posting_paused,
    paymentsPaused: data.payments_paused,
    pauseNote: data.pause_note,
    maxDealAmount: Number(data.max_deal_amount),
    maxCustomerDaily: Number(data.max_customer_daily),
    maxTotalHeld: Number(data.max_total_held),
    maxOpenTasks: data.max_open_tasks,
    updatedAt: Date.parse(data.updated_at),
  };
}

export type ControlsInput = Omit<Controls, "updatedAt">;

/** Ops only (caller checks). Every change is written to the audit log with before/after. */
export async function updateControls(opsId: string, next: ControlsInput): Promise<void> {
  const before = await getControls();
  await createAdminClient()
    .from("platform_controls")
    .update({
      posting_paused: next.postingPaused,
      payments_paused: next.paymentsPaused,
      pause_note: next.pauseNote,
      max_deal_amount: next.maxDealAmount,
      max_customer_daily: next.maxCustomerDaily,
      max_total_held: next.maxTotalHeld,
      max_open_tasks: next.maxOpenTasks,
      updated_at: new Date().toISOString(),
      updated_by: opsId,
    })
    .eq("id", true)
    .throwOnError();
  const { updatedAt: _, ...prev } = before;
  await audit(opsId, "controls.update", "platform", { before: prev, after: next });
}

export type PayinBlock = "payments_paused" | "cap_deal" | "cap_daily" | "cap_total";

/** Checked BEFORE an invoice is created (a pay-in that really arrived is always booked). */
export async function payinBlock(dealId: string, payerId: string, amount: number): Promise<PayinBlock | null> {
  const { data, error } = await createAdminClient().rpc("payin_check", { p_deal_id: dealId, p_payer: payerId, p_amount: amount });
  if (error) throw new DbError(error);
  return (data as PayinBlock | null) ?? null;
}

/** The database refused because posting is paused or money is frozen (SQLSTATE PT423). */
export function isPausedError(e: unknown): boolean {
  return e instanceof DbError && e.code === "PT423";
}

const OPEN_STATUSES = ["open", "awaiting_payment", "matched", "in_progress"] as const;

export async function openTaskCount(customerId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .in("status", OPEN_STATUSES);
  return count ?? 0;
}

/** Append-only record of what Ops did. Never throws: a failed log line must not undo the action. */
export async function audit(actorId: string, action: string, target: string | null, data: Record<string, unknown> = {}): Promise<void> {
  const { error } = await createAdminClient()
    .from("ops_audit_log")
    .insert({ actor_id: actorId, action, target, data: toJson(data) });
  if (error) console.error("audit log failed", action, error.message);
}

export interface AuditLine {
  id: number;
  actorName: string;
  action: string;
  target: string | null;
  at: number;
}

export async function recentAudit(limit = 30): Promise<AuditLine[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("ops_audit_log")
    .select("id, actor_id, action, target, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: number; actor_id: string; action: string; target: string | null; created_at: string }[]>();
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.actor_id))];
  const { data: names } = ids.length
    ? await db.from("profiles").select("id, name").in("id", ids).returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.name]));
  return rows.map((r) => ({
    id: r.id,
    actorName: nameOf.get(r.actor_id) ?? "—",
    action: r.action,
    target: r.target,
    at: Date.parse(r.created_at),
  }));
}

export async function adminIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  return (data ?? []).map((r) => r.id);
}

/** Has this customer never paid for a task? (First task free, 2026-11-22.) Counts real pay-ins only. */
export async function isFirstTask(customerId: string): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("kind", "pay_in")
    .eq("from_account", `ext:${customerId}`);
  // if we can't tell, charge the normal fee — never give a task away because a lookup failed
  if (error || count === null) return false;
  return count === 0;
}
