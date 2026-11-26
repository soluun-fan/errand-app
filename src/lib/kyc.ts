import "server-only";
import { notify } from "@/lib/push";
import { adminIds, audit } from "@/lib/safety";
import { TERMINAL_STATUSES, type CategoryId } from "@/lib/engine";
import { KYC_LEVEL_VERIFIED, KYC_RETENTION_DAYS, type KycDoc } from "@/lib/kyc-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { ageBandOf } from "@/lib/profile-rules";

/**
 * Helper verification (docs/decisions.md 2026-11-18). Everything here runs with the service role
 * AFTER the caller checked who is acting: the applicant for their own files and application, or an
 * admin for review. Documents live in the private `kyc` bucket; Ops sees them through 5-minute links;
 * they're deleted 30 days after the decision.
 */
export const KYC_BUCKET = "kyc";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type ApplicationStatus = "submitted" | "approved" | "rejected" | "changes_requested";
/** "helper": the helper application; "identity": a customer's ID check for jobs in their home (2026-11-26). */
export type KycPurpose = "helper" | "identity";

export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  decisionNote: string | null;
  submittedAt: number;
  decidedAt: number | null;
}

/** The latest application of one kind: a helper application, or a customer's identity check. */
export async function latestApplication(userId: string, purpose: KycPurpose = "helper"): Promise<MyApplication | null> {
  const { data } = await createAdminClient()
    .from("helper_applications")
    .select("id, status, decision_note, submitted_at, decided_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      status: ApplicationStatus;
      decision_note: string | null;
      submitted_at: string;
      decided_at: string | null;
    }>();
  return data
    ? {
        id: data.id,
        status: data.status,
        decisionNote: data.decision_note,
        submittedAt: Date.parse(data.submitted_at),
        decidedAt: data.decided_at ? Date.parse(data.decided_at) : null,
      }
    : null;
}

/** Upload slot inside the applicant's own folder. */
export async function createKycSlot(userId: string, doc: KycDoc, mime: string): Promise<{ path: string; token: string }> {
  const ext = EXT[mime];
  if (!ext || ext === "pdf") throw new Error("Unsupported file type");
  const path = `${userId}/${doc}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(KYC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, token: data.token };
}

async function fileExists(userId: string, path: string): Promise<boolean> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return false;
  const name = path.slice(userId.length + 1);
  const { data } = await createAdminClient().storage.from(KYC_BUCKET).list(userId, { search: name, limit: 1 });
  return Boolean(data?.some((f) => f.name === name));
}

export interface ApplicationInput {
  legalName: string;
  idLast4: string;
  birthDate: string;
  categories: CategoryId[];
  files: Record<KycDoc, string>;
  bank: string;
  accountNumber: string;
  holderName: string;
}

export type SubmitResult = { ok: true } | { ok: false; reason: "files" | "open" };

/** A customer's identity check: the same ID files and Ops review as helpers, nothing else (no kinds, no bank). */
export async function submitIdentity(
  userId: string,
  a: Pick<ApplicationInput, "legalName" | "idLast4" | "birthDate" | "files">,
): Promise<SubmitResult> {
  for (const path of Object.values(a.files)) if (!(await fileExists(userId, path))) return { ok: false, reason: "files" };
  const { error } = await createAdminClient().from("helper_applications").insert({
    user_id: userId,
    purpose: "identity",
    legal_name: a.legalName,
    id_last4: a.idLast4,
    birth_date: a.birthDate,
    categories: [],
    id_front_path: a.files.id_front,
    id_back_path: a.files.id_back,
    selfie_path: a.files.selfie,
    consent_at: new Date().toISOString(),
  });
  if (error) return error.code === "23505" ? { ok: false, reason: "open" } : Promise.reject(new Error(error.message));
  return { ok: true };
}

/** Stores a complete application (all required files must exist in the applicant's folder). */
export async function submitApplication(userId: string, a: ApplicationInput): Promise<SubmitResult> {
  for (const path of Object.values(a.files)) if (!(await fileExists(userId, path))) return { ok: false, reason: "files" };
  const db = createAdminClient();
  // the bank account first: if it fails, nothing is half-saved and the person can simply try again
  // (an application saved without its account would answer every retry with "already submitted")
  await db
    .from("payout_accounts")
    .upsert({
      user_id: userId,
      bank: a.bank,
      account_number: a.accountNumber,
      holder_name: a.holderName,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .throwOnError();
  const { error } = await db.from("helper_applications").insert({
    user_id: userId,
    legal_name: a.legalName,
    id_last4: a.idLast4,
    birth_date: a.birthDate,
    categories: a.categories,
    id_front_path: a.files.id_front,
    id_back_path: a.files.id_back,
    selfie_path: a.files.selfie,
    consent_at: new Date().toISOString(),
  });
  if (error) return error.code === "23505" ? { ok: false, reason: "open" } : Promise.reject(new Error(error.message));
  await db.from("profiles").update({ helper_status: "pending" }).eq("id", userId).throwOnError();
  return { ok: true };
}

/* ---------- Ops ---------- */

export interface QueueItem {
  id: string;
  userId: string;
  legalName: string;
  submittedAt: number;
  purpose: KycPurpose;
}

export async function reviewQueue(): Promise<QueueItem[]> {
  const { data } = await createAdminClient()
    .from("helper_applications")
    .select("id, user_id, legal_name, submitted_at, purpose")
    .eq("status", "submitted")
    .order("submitted_at")
    .limit(100)
    .returns<{ id: string; user_id: string; legal_name: string; submitted_at: string; purpose: KycPurpose }[]>();
  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    legalName: r.legal_name,
    submittedAt: Date.parse(r.submitted_at),
    purpose: r.purpose,
  }));
}

/** Recently approved applications, newest first — where Ops finds one to send back for a re-check. */
export async function recentlyApproved(limit = 30): Promise<(QueueItem & { decidedAt: number })[]> {
  const { data } = await createAdminClient()
    .from("helper_applications")
    .select("id, user_id, legal_name, submitted_at, decided_at, purpose")
    .eq("status", "approved")
    .order("decided_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; user_id: string; legal_name: string; submitted_at: string; decided_at: string; purpose: KycPurpose }[]>();
  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    legalName: r.legal_name,
    submittedAt: Date.parse(r.submitted_at),
    decidedAt: Date.parse(r.decided_at),
    purpose: r.purpose,
  }));
}

/**
 * Undo an approval so the person verifies again (owner 2026-11-26: an approval made with test
 * details couldn't be corrected). The checked name, verified level and age band are cleared, they
 * stop being an active helper, and their bank account must be checked again. Never while they have a
 * job in progress. The name can't simply be edited: it must come from a newly checked ID.
 */
export async function reopenVerification(appId: string, opsId: string, note: string): Promise<"ok" | "changed" | "busy"> {
  const db = createAdminClient();
  const { data: a } = await db
    .from("helper_applications")
    .select("id, user_id, purpose")
    .eq("id", appId)
    .eq("status", "approved")
    .maybeSingle<{ id: string; user_id: string; purpose: KycPurpose }>();
  if (!a) return "changed";
  const { count } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("helper_id", a.user_id)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
  if ((count ?? 0) > 0) return "busy";
  const now = new Date().toISOString();
  const { data: reopened } = await db
    .from("helper_applications")
    .update({ status: "changes_requested", decided_at: now, decided_by: opsId, decision_note: note })
    .eq("id", appId)
    .eq("status", "approved")
    .select("id");
  if (!reopened?.length) return "changed";
  const { data: prof } = await db.from("profiles").select("role").eq("id", a.user_id).single<{ role: string }>();
  // a customer's identity check only clears the verification; a helper's also ends helper work and the bank check
  const helper = a.purpose === "helper";
  await db
    .from("profiles")
    .update({
      // a helper also loses the private-test shortcut, or they'd be back at work with one tap
      ...(helper ? { role: prof?.role === "admin" ? "admin" : "customer", helper_status: null, test_helper: false } : {}),
      kyc_level: 1,
      verified_name: null,
      age_band: null,
      show_age_band: false,
    })
    .eq("id", a.user_id)
    .throwOnError();
  if (helper) await db.from("payout_accounts").update({ verified_at: null }).eq("user_id", a.user_id).throwOnError();
  await audit(opsId, "kyc.reopened", a.user_id, { appId, note });
  return "ok";
}

/** Everyone who can take jobs now, and how they got there — so Ops can spot accounts nobody checked. */
export interface ActiveHelper {
  userId: string;
  name: string;
  /** "id": a real ID review approved them · "test": the private-test shortcut · "none": neither (seed data or a manual edit). */
  via: "id" | "test" | "none";
  jobs: number;
  admin: boolean;
}
export async function activeHelpers(): Promise<ActiveHelper[]> {
  const db = createAdminClient();
  const { data: ps } = await db
    .from("profiles")
    .select("id, name, role, test_helper, completed_count")
    .eq("helper_status", "approved")
    .order("created_at")
    .limit(500)
    .returns<{ id: string; name: string | null; role: string; test_helper: boolean | null; completed_count: number }[]>();
  const ids = (ps ?? []).map((p) => p.id);
  const reviewed = new Set<string>();
  if (ids.length) {
    const { data } = await db
      .from("helper_applications")
      .select("user_id")
      .in("user_id", ids)
      .eq("purpose", "helper")
      .eq("status", "approved")
      .returns<{ user_id: string }[]>();
    for (const r of data ?? []) reviewed.add(r.user_id);
  }
  return (ps ?? []).map((p) => ({
    userId: p.id,
    name: p.name?.trim() || "—",
    via: reviewed.has(p.id) ? "id" : p.test_helper ? "test" : "none",
    jobs: Number(p.completed_count),
    admin: p.role === "admin",
  }));
}

/**
 * Switch off someone's helper access (owner 2026-11-26: test accounts like "fff" were active helpers
 * nobody checked). They become a customer again and may apply properly later; never while they have a
 * job in progress. Their approved application, if any, is sent back too, so the record stays honest.
 */
export async function revokeHelper(userId: string, opsId: string, note: string): Promise<"ok" | "busy" | "changed"> {
  const db = createAdminClient();
  const { data: p } = await db
    .from("profiles")
    .select("role, helper_status")
    .eq("id", userId)
    .maybeSingle<{ role: string; helper_status: string | null }>();
  if (!p || p.helper_status !== "approved") return "changed";
  const { count } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("helper_id", userId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
  if ((count ?? 0) > 0) return "busy";
  const now = new Date().toISOString();
  await db
    .from("helper_applications")
    .update({ status: "changes_requested", decided_at: now, decided_by: opsId, decision_note: note })
    .eq("user_id", userId)
    .eq("purpose", "helper")
    .eq("status", "approved")
    .throwOnError();
  await db
    .from("profiles")
    .update({
      role: p.role === "admin" ? "admin" : "customer",
      helper_status: null,
      test_helper: false,
      kyc_level: 1,
      verified_name: null,
      age_band: null,
      show_age_band: false,
    })
    .eq("id", userId)
    .throwOnError();
  await db.from("payout_accounts").update({ verified_at: null }).eq("user_id", userId).throwOnError();
  await audit(opsId, "helper.revoked", userId, { note });
  return "ok";
}

export interface ApplicationForOps {
  id: string;
  userId: string;
  status: ApplicationStatus;
  legalName: string;
  idLast4: string;
  birthDate: string | null;
  categories: CategoryId[];
  files: Partial<Record<KycDoc, { url: string; pdf: boolean }>>;
  payout: { bank: string; accountMasked: string; holderName: string } | null;
  profileName: string;
  submittedAt: number;
  purpose: KycPurpose;
}

/** One application with 5-minute links to its documents — for an admin only (caller checks). */
export async function applicationForOps(id: string): Promise<ApplicationForOps | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = createAdminClient();
  const { data: a } = await db.from("helper_applications").select("*").eq("id", id).maybeSingle();
  if (!a) return null;
  if (a.status !== "submitted" && a.status !== "approved" && a.status !== "rejected" && a.status !== "changes_requested")
    throw new Error("Unexpected application status");
  const docs: [KycDoc, string | null][] = [
    ["id_front", a.id_front_path],
    ["id_back", a.id_back_path],
    ["selfie", a.selfie_path],
  ];
  const paths = docs.map(([, p]) => p).filter((p): p is string => Boolean(p));
  const signed = paths.length ? ((await db.storage.from(KYC_BUCKET).createSignedUrls(paths, 300)).data ?? []) : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const files: ApplicationForOps["files"] = {};
  for (const [doc, p] of docs) if (p && urlOf.get(p)) files[doc] = { url: urlOf.get(p) as string, pdf: p.endsWith(".pdf") };
  const [{ data: pay }, { data: prof }] = await Promise.all([
    db.from("payout_accounts").select("bank, account_number, holder_name").eq("user_id", a.user_id).maybeSingle(),
    db.from("profiles").select("name").eq("id", a.user_id).maybeSingle(),
  ]);
  return {
    id: a.id,
    userId: a.user_id,
    status: a.status,
    legalName: a.legal_name,
    idLast4: a.id_last4,
    birthDate: a.birth_date,
    categories: a.categories,
    files,
    payout: pay ? { bank: pay.bank, accountMasked: `•••• ${String(pay.account_number).slice(-4)}`, holderName: pay.holder_name } : null,
    profileName: prof?.name ?? "",
    submittedAt: Date.parse(a.submitted_at),
    purpose: a.purpose === "identity" ? "identity" : "helper",
  };
}

export type Decision = "approve" | "reject" | "changes_requested";

/**
 * Records Ops' decision. Approve = verified helper in the chosen categories: verified name, payout
 * account (last 4 only on the profile), and standard identity verification. The application
 * row is updated last, so a failure part-way leaves it in the queue to retry.
 */
export async function decide(
  appId: string,
  opsId: string,
  decision: Decision,
  note: string | null,
  categories: CategoryId[],
): Promise<boolean> {
  const db = createAdminClient();
  const { data: a } = await db.from("helper_applications").select("*").eq("id", appId).eq("status", "submitted").maybeSingle();
  if (!a) return false;
  const now = new Date().toISOString();
  if (a.purpose === "identity") {
    // a customer's ID check (2026-11-26): approval verifies the person — no helper role, kinds or bank
    if (decision === "approve") {
      const { data: prof } = await db.from("profiles").select("kyc_level").eq("id", a.user_id).single<{ kyc_level: number }>();
      await db
        .from("profiles")
        .update({
          kyc_level: Math.max(prof?.kyc_level ?? 1, KYC_LEVEL_VERIFIED),
          verified_name: a.legal_name,
          age_band: a.birth_date ? ageBandOf(String(a.birth_date), new Date()) : null,
        })
        .eq("id", a.user_id)
        .throwOnError();
    }
  } else if (decision === "approve") {
    const { data: pay } = await db.from("payout_accounts").select("bank, account_number, holder_name").eq("user_id", a.user_id).single();
    // Reviewing an ID does not establish who owns the submitted bank account.
    // Account ownership is checked separately against information from the bank.
    const { data: prof } = await db.from("profiles").select("role").eq("id", a.user_id).single();
    await db
      .from("profiles")
      .update({
        role: prof?.role === "admin" ? "admin" : "helper",
        helper_status: "approved",
        // a real review replaces the private-test shortcut (or they'd be blocked once test mode is off)
        test_helper: false,
        kyc_level: KYC_LEVEL_VERIFIED,
        verified_name: a.legal_name,
        // the decade only (opt-in to show, 2026-11-26); the birth date itself is deleted with the files
        age_band: a.birth_date ? ageBandOf(String(a.birth_date), new Date()) : null,
        categories: categories.length ? categories : a.categories,
        payout_bank: pay?.bank ?? null,
        payout_account_last4: pay ? String(pay.account_number).slice(-4) : null,
        payout_holder_name: pay?.holder_name ?? null,
      })
      .eq("id", a.user_id)
      .throwOnError();
    // code review 2026-11-23: approval doesn't check the bank account — tell Ops one is waiting,
    // or the helper's first withdrawal fails with nobody knowing why
    if (pay) {
      await adminIds()
        .then((ids) =>
          notify(ids, {
            title: "push.payoutCheckTitle",
            body: "push.payoutCheckBody",
            url: "/ops/withdrawals",
            tag: `payout-${a.user_id}`,
          }),
        )
        .catch(() => undefined); // best effort: the approval itself is saved
    }
  } else {
    await db
      .from("profiles")
      .update({ helper_status: decision === "reject" ? "rejected" : null })
      .eq("id", a.user_id)
      .throwOnError();
  }
  await db
    .from("helper_applications")
    .update({
      status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested",
      decided_at: now,
      decided_by: opsId,
      decision_note: note,
    })
    .eq("id", appId)
    .eq("status", "submitted")
    .throwOnError();
  return true;
}

/** Deletes ID files and any legacy certificate files 30 days after the decision. */
export async function purgeKycFiles(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const cutoff = new Date(now - KYC_RETENTION_DAYS * 24 * 3_600_000).toISOString();
  const { data } = await db
    .from("helper_applications")
    .select("id, id_front_path, id_back_path, selfie_path, record_path")
    .lt("decided_at", cutoff)
    .is("files_purged_at", null)
    .limit(100)
    .throwOnError();
  let n = 0;
  for (const r of data ?? []) {
    const paths = [r.id_front_path, r.id_back_path, r.selfie_path, r.record_path].filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error } = await db.storage.from(KYC_BUCKET).remove(paths);
      if (error) throw error;
    }
    await db
      .from("helper_applications")
      .update({
        id_front_path: null,
        id_back_path: null,
        selfie_path: null,
        record_path: null,
        birth_date: null,
        files_purged_at: new Date(now).toISOString(),
      })
      .eq("id", r.id)
      .throwOnError();
    n++;
  }
  return n;
}
