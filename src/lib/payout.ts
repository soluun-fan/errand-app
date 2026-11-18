import "server-only";
import { BANKS, cleanLegalName, maskAccount, normalizeAccount, payoutNameOk } from "@/lib/kyc-rules";
import { adminIds, audit } from "@/lib/safety";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A worker's bank account (docs/decisions.md 2026-11-18 "Bank account before working"): needed to
 * work at all — in the fee-only mode customers pay the helper straight into it. Sign-up asks for it;
 * helpers approved without one (or changing it) add it here. The database refuses applications and
 * leaves them out of notifications and the nearby feed until they have one.
 */
export interface MyPayout {
  bank: string;
  masked: string;
  holderName: string;
  verified: boolean;
}

export async function hasPayout(userId: string): Promise<boolean> {
  const { count } = await createAdminClient().from("payout_accounts").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  return (count ?? 0) > 0;
}

/** The helper's own account, number masked (only the last 4 digits are ever shown again). */
export async function myPayout(userId: string): Promise<MyPayout | null> {
  const { data } = await createAdminClient()
    .from("payout_accounts")
    .select("bank, account_number, holder_name, verified_at")
    .eq("user_id", userId)
    .maybeSingle<{ bank: string; account_number: string; holder_name: string; verified_at: string | null }>();
  return data ? { bank: data.bank, masked: maskAccount(data.account_number), holderName: data.holder_name, verified: data.verified_at !== null } : null;
}

export type SetPayoutResult = "ok" | "bank" | "account" | "holder" | "notHelper";

/**
 * Add or change the account. It must be in the helper's own ID-checked name (so a stolen phone
 * can't send someone's pay elsewhere) — then it counts as checked. Helpers without a checked name
 * (approved before ID checks) may add one; Ops is told and checks it. Every change is logged and
 * the helper's profile keeps only the last 4 digits.
 */
export async function setPayout(userId: string, input: { bank: string; accountNumber: string; holderName: string }): Promise<SetPayoutResult> {
  const db = createAdminClient();
  const { data: p } = await db
    .from("profiles")
    .select("role, helper_status, verified_name")
    .eq("id", userId)
    .maybeSingle<{ role: string; helper_status: string | null; verified_name: string | null }>();
  if (!p || p.helper_status !== "approved") return "notHelper";
  if (!(BANKS as readonly string[]).includes(input.bank)) return "bank";
  const account = normalizeAccount(input.accountNumber);
  if (!account) return "account";
  const holder = cleanLegalName(input.holderName);
  if (!holder) return "holder";
  const checkedName = p.verified_name?.trim() || null;
  if (checkedName && !payoutNameOk(checkedName, holder)) return "holder";

  const now = new Date().toISOString();
  const { data: before } = await db.from("payout_accounts").select("account_number").eq("user_id", userId).maybeSingle<{ account_number: string }>();
  await db
    .from("payout_accounts")
    .upsert({ user_id: userId, bank: input.bank, account_number: account, holder_name: holder, verified_at: checkedName ? now : null, updated_at: now })
    .throwOnError();
  await db.from("profiles").update({ payout_bank: input.bank, payout_account_last4: account.slice(-4), payout_holder_name: holder }).eq("id", userId).throwOnError();
  await audit(userId, before ? "payout.changed" : "payout.added", userId, { bank: input.bank, last4: account.slice(-4), checkedName: Boolean(checkedName) });
  if (!checkedName) {
    await notify(await adminIds(), { title: "push.payoutCheckTitle", body: "push.payoutCheckBody", url: `/ops/helpers`, tag: `payout-${userId}` }).catch(() => undefined);
  }
  return "ok";
}
