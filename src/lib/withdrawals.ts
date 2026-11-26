import "server-only";
import { cleanLegalName, maskAccount, payoutNameOk } from "@/lib/kyc-rules";
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
  /** Bank transaction reference recorded by Ops; not an API settlement confirmation. */
  bankReference: string | null;
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
  bankReference: r.status === "sent" && r.note?.startsWith("Bank transaction: ") ? r.note.slice("Bank transaction: ".length) : null,
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

export type RequestResult = { ok: true; withdrawal: Withdrawal } | { ok: false; reason: "noAccount" | "minimum" | "tooMany" | "failed" };

/** The helper asks for everything available. Ops is pushed (target: sent within 15 minutes in opening hours). */
export async function requestWithdrawal(helperId: string, auto = false): Promise<RequestResult> {
  const { data, error } = await createAdminClient().rpc("request_withdrawal", { p_helper: helperId, p_auto: auto }).single<Row>();
  if (error || !data) {
    const m = error?.message ?? "";
    if (/no bank account/.test(m)) return { ok: false, reason: "noAccount" };
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
  /** checked against the bank yet? If not, the first payout is where Ops checks it (2026-11-26) */
  accountChecked: boolean;
  /** for the combined check: the account version and the name on the checked ID */
  accountUpdatedAt: string | null;
  verifiedName: string | null;
}

/** Ops: withdrawals waiting to be sent, oldest first. */
export async function withdrawalQueue(): Promise<QueueItem[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawals").select("*").eq("status", "requested").order("requested_at").limit(200).returns<Row[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.helper_id))];
  const [{ data: people, error: peopleError }, { data: accounts, error: acctError }] = ids.length
    ? await Promise.all([
        db.from("profiles").select("id, name, verified_name").in("id", ids).returns<{ id: string; name: string | null; verified_name: string | null }[]>(),
        db.from("payout_accounts").select("user_id, account_number, verified_at, updated_at").in("user_id", ids).returns<{ user_id: string; account_number: string; verified_at: string | null; updated_at: string }[]>(),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (peopleError) throw new Error(peopleError.message);
  if (acctError) throw new Error(acctError.message);
  const name = new Map((people ?? []).map((p) => [p.id, p.name ?? "—"]));
  const idName = new Map((people ?? []).map((p) => [p.id, p.verified_name]));
  const acct = new Map((accounts ?? []).map((a) => [a.user_id, a]));
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
    // checked, and still the account this withdrawal was made for
    accountChecked: Boolean(acct.get(r.helper_id)?.verified_at) && acct.get(r.helper_id)?.account_number === r.account_number,
    accountUpdatedAt: acct.get(r.helper_id)?.updated_at ?? null,
    verifiedName: idName.get(r.helper_id) ?? null,
  }));
}

/** Ops: sent from the bank app (or it failed — the money goes back to what we owe the helper). Logged; the helper is told. */
export async function decideWithdrawal(id: string, opsId: string, sent: boolean, note: string | null, bankReference?: string): Promise<boolean> {
  const reference = bankReference?.trim();
  if (sent && (!reference || reference.length < 3 || reference.length > 120)) return false;
  const recordedNote = sent ? `Bank transaction: ${reference}` : note;
  const { data, error } = await createAdminClient().rpc("decide_withdrawal", { p_id: id, p_ops: opsId, p_sent: sent, p_note: recordedNote }).single<Row>();
  if (error || !data) return false;
  await audit(opsId, sent ? "withdrawal.sent" : "withdrawal.failed", id, { helperId: data.helper_id, amount: data.amount, reference: data.reference, note: recordedNote, method: "manual_bank" });
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
  /** Ops alone needs the complete destination to query the bank. */
  accountNumber: string;
  holderName: string;
  updatedAt: string;
}

/** Ops: independently check account ownership using the bank, separately from identity review. */
export async function accountsToCheck(): Promise<AccountToCheck[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("payout_accounts").select("user_id, bank, account_number, holder_name, updated_at").is("verified_at", null).limit(100).returns<{ user_id: string; bank: string; account_number: string; holder_name: string; updated_at: string }[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: people, error: peopleError } = await db.from("profiles").select("id, name, verified_name").in("id", rows.map((r) => r.user_id)).returns<{ id: string; name: string | null; verified_name: string | null }[]>();
  if (peopleError) throw new Error(peopleError.message);
  const p = new Map((people ?? []).map((x) => [x.id, x]));
  return rows.map((r) => ({
    userId: r.user_id,
    name: p.get(r.user_id)?.name ?? "—",
    verifiedName: p.get(r.user_id)?.verified_name ?? null,
    bank: r.bank,
    accountMasked: maskAccount(r.account_number),
    accountNumber: r.account_number,
    holderName: r.holder_name,
    updatedAt: r.updated_at,
  }));
}

/** Records a manual BANK check; this is not an automatic bank API verification. */
export async function markAccountChecked(userId: string, opsId: string, evidence: {
  updatedAt: string;
  bankHolderName: string;
  reference: string;
  /** Ops ticked "I checked their ID and it matches" — for helpers approved before names were recorded. */
  identityConfirmed?: boolean;
}): Promise<"ok" | "changed" | "identity" | "holder" | "evidence"> {
  const reference = evidence.reference.trim();
  const holder = cleanLegalName(evidence.bankHolderName);
  if (!holder || reference.length < 3 || reference.length > 120 || !Number.isFinite(Date.parse(evidence.updatedAt))) return "evidence";
  const db = createAdminClient();
  const [account, profile] = await Promise.all([
    db.from("payout_accounts").select("bank, account_number, holder_name, updated_at, verified_at").eq("user_id", userId).maybeSingle<{ bank: string; account_number: string; holder_name: string; updated_at: string; verified_at: string | null }>(),
    db.from("profiles").select("verified_name, helper_status").eq("id", userId).maybeSingle<{ verified_name: string | null; helper_status: string | null }>(),
  ]);
  if (account.error) throw new Error(account.error.message);
  if (profile.error) throw new Error(profile.error.message);
  const a = account.data;
  if (!a || a.verified_at || a.updated_at !== evidence.updatedAt) return "changed";
  // Helpers approved before names were recorded (code review 2026-11-23): Ops may confirm the ID in
  // this same step, so their earnings aren't stuck forever. Only for already-approved helpers.
  const confirmIdentity = !profile.data?.verified_name && evidence.identityConfirmed === true && profile.data?.helper_status === "approved";
  const identityName = profile.data?.verified_name ?? (confirmIdentity ? holder : null);
  if (!identityName) return "identity";
  if (!payoutNameOk(identityName, holder) || !payoutNameOk(a.holder_name, holder)) return "holder";
  // Persist evidence before approving. If the account changes meanwhile, CAS refuses approval.
  // The audit event records a check of this specific snapshot, not a successful approval.
  await audit(opsId, "payout.bank_check_recorded", userId, {
    method: "manual_bank", reference, bank: a.bank, last4: a.account_number.slice(-4), accountUpdatedAt: a.updated_at,
  });
  const { data, error } = await db.from("payout_accounts")
    .update({ verified_at: new Date().toISOString() })
    .eq("user_id", userId).eq("updated_at", a.updated_at)
    .eq("bank", a.bank).eq("account_number", a.account_number).eq("holder_name", a.holder_name)
    .is("verified_at", null).select("user_id");
  if (error) throw new Error(error.message);
  const approved = Boolean(data?.length);
  if (approved && confirmIdentity) {
    await db.from("profiles").update({ verified_name: holder }).eq("id", userId).is("verified_name", null).throwOnError();
  }
  // the outcome is logged too, so an investigation can tell an approval from a refused attempt
  await audit(opsId, "payout.checked", userId, { approved, reference, identityConfirmed: confirmIdentity, last4: a.account_number.slice(-4) });
  return approved ? "ok" : "changed";
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
