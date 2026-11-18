import "server-only";
import { SIMILAR_BITS, hamming } from "@/lib/proof-hash";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Photo / video proof (docs/rules.md §Proof). Files go to the PRIVATE "proofs" bucket through a
 * signed upload URL the server issues after checking the helper; they are shown through
 * short-lived signed read URLs. Fingerprints flag reused pictures — hints only, Ops decides.
 */
export const PROOF_BUCKET = "proofs";
export type ProofKind = "receipt" | "handover" | "start" | "progress";
/** Progress photos per task (a cap against flooding the customer). */
export const MAX_PROGRESS_PROOFS = 20;
export const PROOF_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"] as const;
export const MAX_PROOF_BYTES = 25 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export interface UploadSlot {
  path: string;
  token: string;
}

export async function createUploadSlot(dealId: string, kind: ProofKind, mime: string): Promise<UploadSlot> {
  const ext = EXT[mime];
  if (!ext) throw new Error("Unsupported file type");
  const path = `${dealId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(PROOF_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, token: data.token };
}

export interface ProofInput {
  dealId: string;
  kind: ProofKind;
  path: string;
  mime: string;
  bytes: number;
  sha256: string | null;
  dhash: string | null;
  amount: number | null;
  lat: number | null;
  lng: number | null;
  takenAt: number | null;
  uploadedBy: string;
  /** progress photos: what it shows (≤ 140 chars) */
  note?: string | null;
}

/** Checks the file really arrived, fingerprints it against other deals, stores the row. Returns flags. */
export async function recordProof(p: ProofInput): Promise<string[]> {
  const db = createAdminClient();
  if (!p.path.startsWith(`${p.dealId}/`) || p.path.includes("..")) throw new Error("Bad proof path");
  const name = p.path.slice(p.dealId.length + 1);
  const { data: listed } = await db.storage.from(PROOF_BUCKET).list(p.dealId, { search: name, limit: 1 });
  if (!listed?.some((f) => f.name === name)) throw new Error("Upload not found");

  const flags: string[] = [];
  if (p.sha256) {
    const { count } = await db.from("proofs").select("id", { count: "exact", head: true }).eq("sha256", p.sha256).neq("deal_id", p.dealId);
    if (count) flags.push("reused_photo");
  }
  if (p.dhash && !flags.length) {
    // Small table for now; move to a bit-indexed search (or pgvector) when it grows.
    const { data } = await db.from("proofs").select("dhash").not("dhash", "is", null).neq("deal_id", p.dealId).order("created_at", { ascending: false }).limit(5000);
    if ((data ?? []).some((r) => hamming(r.dhash as string, p.dhash as string) <= SIMILAR_BITS)) flags.push("similar_photo");
  }
  if (p.takenAt !== null && Date.now() - p.takenAt > 6 * 3_600_000) flags.push("old_file");

  await db
    .from("proofs")
    .insert({
      deal_id: p.dealId,
      kind: p.kind,
      file_path: p.path,
      mime: p.mime,
      bytes: p.bytes,
      sha256: p.sha256,
      dhash: p.dhash,
      amount: p.amount,
      lat: p.lat,
      lng: p.lng,
      taken_at: p.takenAt === null ? null : new Date(p.takenAt).toISOString(),
      uploaded_by: p.uploadedBy,
      note: p.note || null,
      flags,
    })
    .throwOnError();
  return flags;
}

export interface ProofView {
  id: string;
  kind: ProofKind;
  url: string | null;
  isVideo: boolean;
  amount: number | null;
  note: string | null;
  flags: string[];
  at: number;
  uploadedBy: string;
  /** Taken back by the helper (hidden from the customer; shown to Ops, marked). */
  removed: boolean;
}

/** A deal's proofs with signed read URLs (valid 1 h). Call only after checking the viewer may see the deal. */
export async function proofsFor(dealId: string, { includeRemoved = false } = {}): Promise<ProofView[]> {
  const db = createAdminClient();
  let q = db
    .from("proofs")
    .select("id, kind, file_path, mime, amount, note, flags, created_at, uploaded_by, removed_at")
    .eq("deal_id", dealId)
    .order("created_at");
  if (!includeRemoved) q = q.is("removed_at", null);
  const { data } = await q.returns<{ id: string; kind: ProofKind; file_path: string | null; mime: string | null; amount: number | null; note: string | null; flags: string[]; created_at: string; uploaded_by: string; removed_at: string | null }[]>();
  const rows = data ?? [];
  const paths = rows.map((r) => r.file_path).filter((x): x is string => Boolean(x));
  const signed = paths.length ? (await db.storage.from(PROOF_BUCKET).createSignedUrls(paths, 3600)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    url: r.file_path ? (urlOf.get(r.file_path) ?? null) : null,
    isVideo: (r.mime ?? "").startsWith("video/"),
    amount: r.amount === null ? null : Number(r.amount),
    note: r.note ?? null,
    flags: r.flags ?? [],
    at: Date.parse(r.created_at),
    uploadedBy: r.uploaded_by,
    removed: r.removed_at !== null,
  }));
}

/** How many proofs of one kind a task has (start photo present? progress cap). */
export async function proofCount(dealId: string, kind: ProofKind, uploadedBy?: string): Promise<number> {
  let q = createAdminClient().from("proofs").select("id", { count: "exact", head: true }).eq("deal_id", dealId).eq("kind", kind).is("removed_at", null);
  if (uploadedBy) q = q.eq("uploaded_by", uploadedBy); // a task posted anew: the earlier helper's photos don't count
  const { count } = await q;
  return count ?? 0;
}

/** The helper takes back their own progress / handover photo (hidden, kept for Ops). True if it was theirs and live. */
export async function removeProof(proofId: string, dealId: string, helperId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("proofs")
    .update({ removed_at: new Date().toISOString(), removed_by: helperId })
    .eq("id", proofId)
    .eq("deal_id", dealId)
    .eq("uploaded_by", helperId)
    .in("kind", ["progress", "handover"])
    .is("removed_at", null)
    .select("id");
  return Boolean(data?.length);
}
