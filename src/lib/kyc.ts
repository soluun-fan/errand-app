import "server-only";
import type { CategoryId } from "@/lib/engine";
import { KYC_LEVEL_VERIFIED, KYC_RETENTION_DAYS, type KycDoc } from "@/lib/kyc-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Helper verification (docs/decisions.md 2026-11-18). Everything here runs with the service role
 * AFTER the caller checked who is acting: the applicant for their own files and application, or an
 * admin for review. Documents live in the private `kyc` bucket; Ops sees them through 5-minute links;
 * they're deleted 30 days after the decision.
 */
export const KYC_BUCKET = "kyc";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type ApplicationStatus = "submitted" | "approved" | "rejected" | "changes_requested";

export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  decisionNote: string | null;
  submittedAt: number;
  decidedAt: number | null;
}

export async function latestApplication(userId: string): Promise<MyApplication | null> {
  const { data } = await createAdminClient()
    .from("helper_applications")
    .select("id, status, decision_note, submitted_at, decided_at")
    .eq("user_id", userId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: ApplicationStatus; decision_note: string | null; submitted_at: string; decided_at: string | null }>();
  return data
    ? { id: data.id, status: data.status, decisionNote: data.decision_note, submittedAt: Date.parse(data.submitted_at), decidedAt: data.decided_at ? Date.parse(data.decided_at) : null }
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

/** Stores a complete application (all required files must exist in the applicant's folder). */
export async function submitApplication(userId: string, a: ApplicationInput): Promise<SubmitResult> {
  for (const path of Object.values(a.files)) if (!(await fileExists(userId, path))) return { ok: false, reason: "files" };
  const db = createAdminClient();
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
  await db
    .from("payout_accounts")
    .upsert({ user_id: userId, bank: a.bank, account_number: a.accountNumber, holder_name: a.holderName, verified_at: null, updated_at: new Date().toISOString() })
    .throwOnError();
  await db.from("profiles").update({ helper_status: "pending" }).eq("id", userId).throwOnError();
  return { ok: true };
}

/* ---------- Ops ---------- */

export interface QueueItem {
  id: string;
  userId: string;
  legalName: string;
  submittedAt: number;
}

export async function reviewQueue(): Promise<QueueItem[]> {
  const { data } = await createAdminClient()
    .from("helper_applications")
    .select("id, user_id, legal_name, submitted_at")
    .eq("status", "submitted")
    .order("submitted_at")
    .limit(100)
    .returns<{ id: string; user_id: string; legal_name: string; submitted_at: string }[]>();
  return (data ?? []).map((r) => ({ id: r.id, userId: r.user_id, legalName: r.legal_name, submittedAt: Date.parse(r.submitted_at) }));
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
}

/** One application with 5-minute links to its documents — for an admin only (caller checks). */
export async function applicationForOps(id: string): Promise<ApplicationForOps | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = createAdminClient();
  const { data: a } = await db.from("helper_applications").select("*").eq("id", id).maybeSingle();
  if (!a) return null;
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
  };
}

export type Decision = "approve" | "reject" | "changes_requested";

/**
 * Records Ops' decision. Approve = verified helper in the chosen categories: verified name, payout
 * account (last 4 only on the profile), and standard identity verification. The application
 * row is updated last, so a failure part-way leaves it in the queue to retry.
 */
export async function decide(appId: string, opsId: string, decision: Decision, note: string | null, categories: CategoryId[]): Promise<boolean> {
  const db = createAdminClient();
  const { data: a } = await db.from("helper_applications").select("*").eq("id", appId).eq("status", "submitted").maybeSingle();
  if (!a) return false;
  const now = new Date().toISOString();
  if (decision === "approve") {
    const { data: pay } = await db.from("payout_accounts").select("bank, account_number, holder_name").eq("user_id", a.user_id).single();
    await db.from("payout_accounts").update({ verified_at: now }).eq("user_id", a.user_id).throwOnError();
    const { data: prof } = await db.from("profiles").select("role").eq("id", a.user_id).single();
    await db
      .from("profiles")
      .update({
        role: prof?.role === "admin" ? "admin" : "helper",
        helper_status: "approved",
        kyc_level: KYC_LEVEL_VERIFIED,
        verified_name: a.legal_name,
        categories: categories.length ? categories : a.categories,
        payout_bank: pay?.bank ?? null,
        payout_account_last4: pay ? String(pay.account_number).slice(-4) : null,
        payout_holder_name: pay?.holder_name ?? null,
      })
      .eq("id", a.user_id)
      .throwOnError();
  } else {
    await db
      .from("profiles")
      .update({ helper_status: decision === "reject" ? "rejected" : null })
      .eq("id", a.user_id)
      .throwOnError();
  }
  await db
    .from("helper_applications")
    .update({ status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested", decided_at: now, decided_by: opsId, decision_note: note })
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
    .limit(100);
  let n = 0;
  for (const r of data ?? []) {
    const paths = [r.id_front_path, r.id_back_path, r.selfie_path, r.record_path].filter((p): p is string => Boolean(p));
    if (paths.length) await db.storage.from(KYC_BUCKET).remove(paths);
    await db
      .from("helper_applications")
      .update({ id_front_path: null, id_back_path: null, selfie_path: null, record_path: null, birth_date: null, files_purged_at: new Date(now).toISOString() })
      .eq("id", r.id);
    n++;
  }
  return n;
}
