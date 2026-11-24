import "server-only";
import { LEGAL_VERSIONS, type LegalDoc } from "@/lib/legal-rules";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORK_BUCKET } from "@/lib/work-photos";

/**
 * Registration, documents and leaving (docs/decisions.md 2026-11-18 "Registration and terms").
 */

const COLUMN: Record<LegalDoc, string> = { terms: "terms_version", privacy: "privacy_version", helper: "helper_terms_version" };

/** The person accepted the current version of a document: kept on the profile and in the history. */
export async function recordAcceptance(userId: string, doc: LegalDoc): Promise<void> {
  const db = createAdminClient();
  await db.from("profiles").update({ [COLUMN[doc]]: LEGAL_VERSIONS[doc] }).eq("id", userId).throwOnError();
  await db
    .from("legal_acceptances")
    .upsert({ user_id: userId, document: doc, version: LEGAL_VERSIONS[doc] }, { onConflict: "user_id,document,version", ignoreDuplicates: true })
    .throwOnError();
}

export type CloseBlock = "activeTasks" | "earnings" | "unpaid" | "admin";

/** What stops this account from being closed right now (empty = it can be). */
export async function closeBlocks(userId: string, role: string): Promise<CloseBlock[]> {
  const db = createAdminClient();
  const out: CloseBlock[] = [];
  if (role === "admin") out.push("admin");
  const active = ["awaiting_payment", "open", "matched", "in_progress", "check", "disputed", "held"];
  const [asCustomer, asHelper, payable, payout] = await Promise.all([
    db.from("deals").select("id", { count: "exact", head: true }).eq("customer_id", userId).in("status", active),
    db.from("deals").select("id", { count: "exact", head: true }).eq("helper_id", userId).in("status", active),
    db.rpc("payable_balance", { p_user: userId }),
    db.rpc("account_balance", { p_account: `payout:${userId}` }),
  ]);
  if ((asCustomer.count ?? 0) + (asHelper.count ?? 0) > 0) out.push("activeTasks");
  if (Number(payable.data ?? 0) > 0 || Number(payout.data ?? 0) > 0) out.push("earnings");
  // an open "not paid" report on an older fee-only task (either side) must be settled first
  const { data: reports } = await db.from("direct_payments").select("deal_id").not("unpaid_reported_at", "is", null).is("resolved_at", null).limit(200).returns<{ deal_id: string }[]>();
  if (reports?.length) {
    const { count } = await db
      .from("deals")
      .select("id", { count: "exact", head: true })
      .in("id", reports.map((r) => r.deal_id))
      .or(`customer_id.eq.${userId},helper_id.eq.${userId}`);
    if ((count ?? 0) > 0) out.push("unpaid");
  }
  return out;
}

/**
 * Close an account at the owner's request: personal details, bank account, devices, saved places and
 * public photos are removed; sign-in is blocked. Tasks, payments, ratings and the ledger stay (the law
 * requires keeping payment records; names on them read "Deleted user"). Logged.
 */
export async function closeAccount(userId: string): Promise<boolean> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  // public photos first (files in the public bucket)
  const { data: photos } = await db
    .from("work_photos")
    .select("id, file_path")
    .or(`helper_id.eq.${userId},uploaded_by.eq.${userId}`)
    .in("status", ["asked", "shown", "uploading"])
    .returns<{ id: string; file_path: string | null }[]>();
  const files = (photos ?? []).map((p) => p.file_path).filter((f): f is string => Boolean(f));
  if (files.length) await db.storage.from(WORK_BUCKET).remove(files);
  if (photos?.length) await db.from("work_photos").update({ status: "removed", removed_by: userId, decided_at: now }).in("id", photos.map((p) => p.id));

  await Promise.all([
    db.from("payout_accounts").delete().eq("user_id", userId),
    db.from("push_subscriptions").delete().eq("user_id", userId),
    db.from("saved_addresses").delete().eq("user_id", userId),
    db.from("saved_helpers").delete().or(`customer_id.eq.${userId},helper_id.eq.${userId}`),
    db.from("helper_presence").delete().eq("user_id", userId),
    // helper standards (2026-11-22): live job position and the routes kept for disputes
    db.from("job_locations").delete().eq("helper_id", userId),
    db.from("job_location_points").delete().eq("helper_id", userId),
  ]);
  const { error } = await db
    .from("profiles")
    .update({
      name: "",
      area: null,
      bio: null,
      from_price: null,
      categories: [],
      languages: [],
      verified_name: null,
      payout_bank: null,
      payout_account_last4: null,
      payout_holder_name: null,
      age_confirmed_at: null,
      test_helper: false,
      helper_status: null,
      deleted_at: now,
    })
    .eq("id", userId);
  if (error) {
    console.error("close account failed", error.message);
    return false;
  }
  // block sign-in (the phone stays tied to the closed account; to come back, contact us)
  await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" }).catch((e: unknown) => console.error("ban failed", e));
  await audit(userId, "account.closed", userId, {});
  return true;
}
