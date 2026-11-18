import "server-only";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The helper's pay in the fee-only mode (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"): the
 * customer pays the helper themselves after the job — bank transfer to the account shown, QPay, or
 * cash. Both sides mark it; an open "not paid" report alerts Ops and stops the customer posting.
 */
export interface DirectPayState {
  /** what the customer owes the helper: the agreed price + what the helper spent on items (receipt) */
  amount: number;
  customerPaidAt: number | null;
  helperReceivedAt: number | null;
  unpaidReportedAt: number | null;
  resolvedAt: number | null;
}

export interface PayeeAccount {
  bank: string;
  accountNumber: string;
  holderName: string;
  /** paid to the organisation (its worker did the job) */
  org: boolean;
}

/** Owed to the helper: the price + the receipt (if they bought items). */
export const owedToHelper = (d: ErrandDeal) => d.fee + (d.receiptAmount ?? 0);

/** When the customer is asked to pay the helper: once the helper has finished. */
export const directPayOpen = (d: ErrandDeal) => d.payMode === "direct" && d.helperId !== null && (d.status === "check" || d.status === "released" || d.status === "disputed");

const ms = (v: string | null) => (v ? Date.parse(v) : null);

export async function directPayState(d: ErrandDeal): Promise<DirectPayState> {
  const { data } = await createAdminClient()
    .from("direct_payments")
    .select("amount, customer_paid_at, helper_received_at, unpaid_reported_at, resolved_at")
    .eq("deal_id", d.id)
    .maybeSingle<{ amount: number; customer_paid_at: string | null; helper_received_at: string | null; unpaid_reported_at: string | null; resolved_at: string | null }>();
  return {
    amount: owedToHelper(d),
    customerPaidAt: ms(data?.customer_paid_at ?? null),
    helperReceivedAt: ms(data?.helper_received_at ?? null),
    unpaidReportedAt: ms(data?.unpaid_reported_at ?? null),
    resolvedAt: ms(data?.resolved_at ?? null),
  };
}

/**
 * Where the customer sends the money: the company's account for an organisation's job, else the
 * helper's own (both checked by Ops). Shown in full only to this task's customer, once the job is done.
 */
export async function payeeAccount(d: ErrandDeal): Promise<PayeeAccount | null> {
  const db = createAdminClient();
  if (d.payeeOrgId) {
    const { data } = await db.from("organization_payout_accounts").select("bank, account_number, holder_name").eq("org_id", d.payeeOrgId).maybeSingle<{ bank: string; account_number: string; holder_name: string }>();
    return data ? { bank: data.bank, accountNumber: data.account_number, holderName: data.holder_name, org: true } : null;
  }
  if (!d.helperId) return null;
  const { data } = await db.from("payout_accounts").select("bank, account_number, holder_name").eq("user_id", d.helperId).maybeSingle<{ bank: string; account_number: string; holder_name: string }>();
  return data ? { bank: data.bank, accountNumber: data.account_number, holderName: data.holder_name, org: false } : null;
}

type Mark = "customer_paid" | "helper_received" | "unpaid_reported";

/** One side's mark. Returns false if it wasn't theirs to make (the caller checks who is asking). */
export async function markDirectPay(d: ErrandDeal, mark: Mark): Promise<boolean> {
  if (!directPayOpen(d)) return false;
  const now = new Date().toISOString();
  const db = createAdminClient();
  const col = mark === "customer_paid" ? "customer_paid_at" : mark === "helper_received" ? "helper_received_at" : "unpaid_reported_at";
  const patch: Record<string, unknown> = { deal_id: d.id, amount: owedToHelper(d), [col]: now, updated_at: now };
  // "received" settles an earlier "not paid" report by itself
  if (mark === "helper_received") Object.assign(patch, { unpaid_reported_at: null });
  await db.from("direct_payments").upsert(patch, { onConflict: "deal_id" }).throwOnError();
  return true;
}

/** Ops closes a "not paid" report (paid after all, or settled otherwise). Logged by the caller. */
export async function resolveUnpaid(dealId: string, opsId: string, note: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("direct_payments")
    .update({ resolved_at: new Date().toISOString(), resolved_by: opsId, note: note.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .not("unpaid_reported_at", "is", null)
    .is("resolved_at", null)
    .select("deal_id");
  return Boolean(data?.length);
}

/** A customer with an open "not paid" report can't post new tasks until Ops settles it. */
export async function hasOpenUnpaid(customerId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data } = await db.from("direct_payments").select("deal_id").not("unpaid_reported_at", "is", null).is("resolved_at", null).limit(50).returns<{ deal_id: string }[]>();
  const ids = (data ?? []).map((r) => r.deal_id);
  if (!ids.length) return false;
  const { count } = await db.from("deals").select("id", { count: "exact", head: true }).in("id", ids).eq("customer_id", customerId);
  return (count ?? 0) > 0;
}

/** For Ops: open "not paid" reports, oldest first. */
export async function openUnpaidReports(): Promise<{ dealId: string; amount: number; reportedAt: number }[]> {
  const { data } = await createAdminClient()
    .from("direct_payments")
    .select("deal_id, amount, unpaid_reported_at")
    .not("unpaid_reported_at", "is", null)
    .is("resolved_at", null)
    .order("unpaid_reported_at")
    .limit(100)
    .returns<{ deal_id: string; amount: number; unpaid_reported_at: string }[]>();
  return (data ?? []).map((r) => ({ dealId: r.deal_id, amount: Number(r.amount), reportedAt: Date.parse(r.unpaid_reported_at) }));
}
