import "server-only";
import { maskAccount } from "@/lib/kyc-rules";
import { notify } from "@/lib/push";
import { getRules } from "@/lib/rules";
import { adminIds, audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Helper earnings and withdrawals (owner's V1 Master Spec C10, A4). Earnings are a service fee we
 * owe — withdraw-only, never spent or sent in the app, paid only to the helper's own checked bank
 * account, always the full available amount. Pilot: Ops sends each one from the bank app and taps
 * "Sent"; the database (request_withdrawal / decide_withdrawal) keeps the ledger exact:
 *   payable:<helper> → payout:<helper> (asked)  → ext:<helper> (sent) | back to payable (failed).
 * Unclaimed earnings are asked for automatically after `autoPayoutDays`.
 */
export type WithdrawalStatus = "requested" | "sent" | "failed";

export interface Withdrawal {
  id: string;
  amount: number;
  reference: string;
  status: WithdrawalStatus;
  auto: boolean;
  requestedAt: number;
  decidedAt: number | null;
  /** masked for the helper's own view */
  account: string;
  bank: string;
}

interface Row {
  id: string;
  helper_id: string;
  amount: number;
  reference: string;
  status: WithdrawalStatus;
  auto: boolean;
  requested_at: string;
  decided_at: string | null;
  bank: string;
  account_number: string;
  holder_name: string;
  note: string | null;
}

export interface EarningsSummary {
  /** released to the helper, not yet asked for */
  available: number;
  /** asked for, Ops hasn't sent it yet */
  onTheWay: number;
  recent: Withdrawal[];
  minimum: number;
  perDay: number;
  autoPayoutDays: number;
  /** their bank account is checked (withdrawals go only there) */
  accountChecked: boolean;
}

const toView = (r: Row): Withdrawal => ({
  id: r.id,
  amount: Number(r.amount),
  reference: r.reference,
  status: r.status,
  auto: r.auto,
  requestedAt: Date.parse(r.requested_at),
  decidedAt: r.decided_at ? Date.parse(r.decided_at) : null,
  account: maskAccount(r.account_number),
  bank: r.bank,
});

export async function earningsSummary(helperId: string): Promise<EarningsSummary> {
  const db = createAdminClient();
  const [available, onTheWay, rows, rules, acct] = await Promise.all([
    db.rpc("payable_balance", { p_user: helperId }),
    db.rpc("account_balance", { p_account: `payout:${helperId}` }),
    db.from("withdrawals").select("*").eq("helper_id", helperId).order("requested_at", { ascending: false }).limit(20).returns<Row[]>(),
    getRules(),
    db.from("payout_accounts").select("verified_at").eq("user_id", helperId).maybeSingle<{ verified_at: string | null }>(),
  ]);
  // Failed reads must not look like zero earnings, an empty queue, or an unchecked account.
  for (const result of [available, onTheWay, rows, acct]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    available: Number(available.data ?? 0),
    onTheWay: Number(onTheWay.data ?? 0),
    recent: (rows.data ?? []).map(toView),
    minimum: rules.withdrawMin,
    perDay: rules.withdrawalsPerDay,
    autoPayoutDays: rules.autoPayoutDays,
    accountChecked: Boolean(acct.data?.verified_at),
  };
}

export type RequestResult = { ok: true; withdrawal: Withdrawal } | { ok: false; reason: "unchecked" | "minimum" | "tooMany" | "failed" };

/** The helper asks for everything available. Ops is pushed (target: sent within 15 minutes in opening hours). */
export async function requestWithdrawal(helperId: string, auto = false): Promise<RequestResult> {
  const { data, error } = await createAdminClient().rpc("request_withdrawal", { p_helper: helperId, p_auto: auto }).single<Row>();
  if (error || !data) {
    const m = error?.message ?? "";
    if (/not checked/.test(m)) return { ok: false, reason: "unchecked" };
    if (/minimum/.test(m)) return { ok: false, reason: "minimum" };
    if (/too many/.test(m)) return { ok: false, reason: "tooMany" };
    console.error("withdrawal request failed", m);
    return { ok: false, reason: "failed" };
  }
  await notify(await adminIds(), { title: "push.withdrawTitle", body: "push.withdrawBody", params: { reference: data.reference }, url: "/ops/withdrawals", tag: "withdrawals" }).catch(() => undefined);
  return { ok: true, withdrawal: toView(data) };
}

export interface QueueItem {
  id: string;
  helperId: string;
  helperName: string;
  amount: number;
  reference: string;
  bank: string;
  /** in full — Ops types it into the bank app */
  accountNumber: string;
  holderName: string;
  auto: boolean;
  requestedAt: number;
}

/** Ops: withdrawals waiting to be sent, oldest first. */
export async function withdrawalQueue(): Promise<QueueItem[]> {
  const db = createAdminClient();
  const { data } = await db.from("withdrawals").select("*").eq("status", "requested").order("requested_at").limit(200).returns<Row[]>();
  const rows = data ?? [];
  const { data: people } = rows.length
    ? await db.from("profiles").select("id, name").in("id", [...new Set(rows.map((r) => r.helper_id))]).returns<{ id: string; name: string | null }[]>()
    : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.name ?? "—"]));
  return rows.map((r) => ({
    id: r.id,
    helperId: r.helper_id,
    helperName: name.get(r.helper_id) ?? "—",
    amount: Number(r.amount),
    reference: r.reference,
    bank: r.bank,
    accountNumber: r.account_number,
    holderName: r.holder_name,
    auto: r.auto,
    requestedAt: Date.parse(r.requested_at),
  }));
}

/** Ops: sent from the bank app (or it failed — the money goes back to what we owe the helper). Logged; the helper is told. */
export async function decideWithdrawal(id: string, opsId: string, sent: boolean, note: string | null): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("decide_withdrawal", { p_id: id, p_ops: opsId, p_sent: sent, p_note: note }).single<Row>();
  if (error || !data) return false;
  await audit(opsId, sent ? "withdrawal.sent" : "withdrawal.failed", id, { helperId: data.helper_id, amount: data.amount, reference: data.reference, note });
  await notify([data.helper_id], {
    title: sent ? "push.withdrawSentTitle" : "push.withdrawFailedTitle",
    body: sent ? "push.withdrawSentBody" : "push.withdrawFailedBody",
    params: { reference: data.reference },
    url: "/earnings",
    tag: `withdrawal-${data.id}`,
  }).catch(() => undefined);
  return true;
}

export interface AccountToCheck {
  userId: string;
  name: string;
  verifiedName: string | null;
  bank: string;
  accountMasked: string;
  holderName: string;
}

/** Ops: bank accounts added without an ID-checked name — compare the holder with the ID before payouts. */
export async function accountsToCheck(): Promise<AccountToCheck[]> {
  const db = createAdminClient();
  const { data } = await db.from("payout_accounts").select("user_id, bank, account_number, holder_name").is("verified_at", null).limit(100).returns<{ user_id: string; bank: string; account_number: string; holder_name: string }[]>();
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: people } = await db.from("profiles").select("id, name, verified_name").in("id", rows.map((r) => r.user_id)).returns<{ id: string; name: string | null; verified_name: string | null }[]>();
  const p = new Map((people ?? []).map((x) => [x.id, x]));
  return rows.map((r) => ({
    userId: r.user_id,
    name: p.get(r.user_id)?.name ?? "—",
    verifiedName: p.get(r.user_id)?.verified_name ?? null,
    bank: r.bank,
    accountMasked: maskAccount(r.account_number),
    holderName: r.holder_name,
  }));
}

/** Ops checked the holder name against the helper's ID: payouts may go there now. Logged. */
export async function markAccountChecked(userId: string, opsId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("payout_accounts").update({ verified_at: new Date().toISOString() }).eq("user_id", userId).is("verified_at", null).select("user_id");
  if (!data?.length) return false;
  await audit(opsId, "payout.checked", userId, {});
  return true;
}

/** Background job: earnings left unclaimed for `autoPayoutDays` are asked for automatically. */
export async function runAutoPayouts(): Promise<number> {
  const rules = await getRules();
  const { data, error } = await createAdminClient().rpc("due_auto_payouts", { p_days: rules.autoPayoutDays });
  if (error) throw new Error(error.message);
  let n = 0;
  for (const r of (data ?? []) as { helper_id: string }[]) {
    const out = await requestWithdrawal(r.helper_id, true);
    if (out.ok) n++;
  }
  return n;
}
