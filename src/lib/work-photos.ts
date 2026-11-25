import "server-only";
import { categoryTrust, type CategoryId } from "@/lib/engine";
import { PROOF_BUCKET } from "@/lib/proofs";
import { adminIds, audit } from "@/lib/safety";
import { notify } from "@/lib/push";
import { TASK_PHOTO_BUCKET } from "@/lib/task-photos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public work photos (docs/decisions.md 2026-11-18 "Work photos"): photos in reviews and the helper's
 * portfolio, shown on their profile, their card, Home and the landing page.
 *
 * Consent first: a review photo is added by the customer, who is told it's public; a portfolio
 * photo is one of the helper's own job photos and goes public only after that job's customer says
 * yes. Never care work. Only then is a re-checked JPEG copied to the PUBLIC bucket under a random
 * name; removing or hiding deletes it. The database checks the same rules (work_photos_check).
 */
export const WORK_BUCKET = "work-photos";
export const MAX_REVIEW_PHOTOS = 3;
export const MAX_PORTFOLIO_PER_TASK = 4;
const MAX_BYTES = 10 * 1024 * 1024;
/** Distinct reports that take a photo down before Ops looks. */
export const AUTO_HIDE_REPORTS = 3;
export const REPORT_REASONS = ["private", "notWork", "offensive", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

type Status = "uploading" | "asked" | "shown" | "declined" | "removed" | "hidden";
interface Row {
  id: string;
  deal_id: string;
  helper_id: string;
  source: "review" | "helper";
  uploaded_by: string;
  proof_id: string | null;
  staging_path: string | null;
  file_path: string | null;
  status: Status;
  in_portfolio: boolean;
  reports: number;
  show_price: boolean;
  created_at: string;
}
const COLS = "id, deal_id, helper_id, source, uploaded_by, proof_id, staging_path, file_path, status, in_portfolio, reports, show_price, created_at";

const publicUrl = (path: string) => createAdminClient().storage.from(WORK_BUCKET).getPublicUrl(path).data.publicUrl;

/** A real JPEG (starts FF D8 FF), not too big — checked again on the server, whatever the browser said. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes.length <= MAX_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Copy a private file into the public bucket under a new random name. */
async function publish(bucket: string, path: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(error?.message ?? "photo not found");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!looksLikeJpeg(bytes)) throw new Error("not a JPEG photo");
  const name = `${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from(WORK_BUCKET).upload(name, bytes, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
  if (up.error) throw new Error(up.error.message);
  return name;
}

async function unpublish(path: string | null): Promise<void> {
  if (path) await createAdminClient().storage.from(WORK_BUCKET).remove([path]);
}

async function releasedDeal(dealId: string) {
  const { data } = await createAdminClient()
    .from("deals")
    .select("id, type, status, customer_id, helper_id, category")
    .eq("id", dealId)
    .maybeSingle<{ id: string; type: string; status: string; customer_id: string; helper_id: string | null; category: CategoryId }>();
  if (!data || data.type !== "errand" || data.status !== "released" || !data.helper_id || categoryTrust(data.category) === "care") return null;
  return data as typeof data & { helper_id: string };
}

/* ---------- review photos (customer, while rating) ---------- */

export interface ReviewPhotoSlot {
  id: string;
  path: string;
  token: string;
}

/** A signed upload URL for one review photo (waits privately until the rating is sent). */
export async function createReviewPhotoSlot(dealId: string, customerId: string): Promise<ReviewPhotoSlot | "no" | "tooMany"> {
  const d = await releasedDeal(dealId);
  if (!d || d.customer_id !== customerId) return "no";
  const db = createAdminClient();
  const { count } = await db.from("work_photos").select("id", { count: "exact", head: true }).eq("deal_id", dealId).eq("source", "review").in("status", ["uploading", "shown"]);
  if ((count ?? 0) >= MAX_REVIEW_PHOTOS) return "tooMany";
  const path = `r/${customerId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await db.storage.from(TASK_PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  const { data: row, error: insErr } = await db
    .from("work_photos")
    .insert({ deal_id: dealId, helper_id: d.helper_id, source: "review", uploaded_by: customerId, staging_path: path, status: "uploading" })
    .select("id")
    .single<{ id: string }>();
  if (insErr || !row) return insErr?.code === "23514" ? "tooMany" : "no";
  return { id: row.id, path, token: data.token };
}

/** Rating sent: the customer's waiting uploads for this task go public (with the review). */
export async function attachReviewPhotos(dealId: string, customerId: string, ids: readonly string[], stars: number): Promise<number> {
  if (!ids.length) return 0;
  const db = createAdminClient();
  const { data } = await db
    .from("work_photos")
    .select(COLS)
    .in("id", ids.slice(0, MAX_REVIEW_PHOTOS))
    .eq("deal_id", dealId)
    .eq("uploaded_by", customerId)
    .eq("source", "review")
    .eq("status", "uploading")
    .returns<Row[]>();
  let n = 0;
  for (const r of data ?? []) {
    if (!r.staging_path) continue;
    try {
      const file = await publish(TASK_PHOTO_BUCKET, r.staging_path);
      // 4★ and up also count as the helper's work; a low review keeps its photos on the review only
      await db
        .from("work_photos")
        // show_price: the review screen says the price is shown (workPhotos.reviewSub)
        .update({ status: "shown", file_path: file, staging_path: null, in_portfolio: stars >= 4, show_price: true, decided_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("status", "uploading")
        .throwOnError();
      n++;
    } catch (e) {
      console.error("review photo publish failed", r.id, e);
      continue; // left "uploading": the clean-up deletes it
    }
    await db.storage.from(TASK_PHOTO_BUCKET).remove([r.staging_path]);
  }
  return n;
}

/** Background job: review uploads never sent with a rating (after a day), files first. */
export async function purgeLooseReviewPhotos(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const cutoff = new Date(now - 24 * 3_600_000).toISOString();
  const { data } = await db.from("work_photos").select("id, staging_path").eq("status", "uploading").lt("created_at", cutoff).limit(200).returns<{ id: string; staging_path: string | null }[]>();
  const rows = data ?? [];
  if (!rows.length) return 0;
  const paths = rows.map((r) => r.staging_path).filter((x): x is string => Boolean(x));
  if (paths.length) {
    const { error } = await db.storage.from(TASK_PHOTO_BUCKET).remove(paths);
    if (error) throw new Error(error.message);
  }
  await db.from("work_photos").delete().in("id", rows.map((r) => r.id)).eq("status", "uploading").throwOnError();
  return rows.length;
}

/* ---------- portfolio (helper asks, customer answers) ---------- */

/** The helper's photos of a finished job they could show (own handover / progress JPEGs). */
export async function portfolioCandidates(dealId: string, helperId: string): Promise<{ proofId: string; url: string | null; status: Status | null; photoId: string | null }[]> {
  const d = await releasedDeal(dealId);
  if (!d || d.helper_id !== helperId) return [];
  const db = createAdminClient();
  const [{ data: proofs }, { data: asked }] = await Promise.all([
    db
      .from("proofs")
      .select("id, file_path")
      .eq("deal_id", dealId)
      .eq("uploaded_by", helperId)
      .in("kind", ["handover", "progress"])
      .eq("mime", "image/jpeg")
      .is("removed_at", null)
      .order("created_at")
      .limit(20)
      .returns<{ id: string; file_path: string | null }[]>(),
    db.from("work_photos").select("id, proof_id, status").eq("deal_id", dealId).eq("source", "helper").returns<{ id: string; proof_id: string; status: Status }[]>(),
  ]);
  const rows = (proofs ?? []).filter((p) => p.file_path);
  if (!rows.length) return [];
  const signed = (await db.storage.from(PROOF_BUCKET).createSignedUrls(rows.map((p) => p.file_path as string), 3600)).data ?? [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const state = new Map((asked ?? []).map((a) => [a.proof_id, a]));
  return rows.map((p) => ({ proofId: p.id, url: urlOf.get(p.file_path as string) ?? null, status: state.get(p.id)?.status ?? null, photoId: state.get(p.id)?.id ?? null }));
}

/** The helper asks to show some of their photos of this job. Returns how many were asked. */
export async function askToShow(dealId: string, helperId: string, proofIds: readonly string[]): Promise<number | "no" | "tooMany"> {
  const d = await releasedDeal(dealId);
  if (!d || d.helper_id !== helperId) return "no";
  const db = createAdminClient();
  const { count } = await db.from("work_photos").select("id", { count: "exact", head: true }).eq("deal_id", dealId).eq("source", "helper");
  const room = MAX_PORTFOLIO_PER_TASK - (count ?? 0);
  const ids = [...new Set(proofIds)];
  if (ids.length > room) return "tooMany";
  let n = 0;
  for (const proofId of ids) {
    const { error } = await db.from("work_photos").insert({ deal_id: dealId, helper_id: helperId, source: "helper", uploaded_by: helperId, proof_id: proofId, status: "asked" });
    if (!error) n++;
    else if (error.code !== "23505" && error.code !== "23514") throw new Error(error.message);
  }
  if (n > 0) {
    await notify([d.customer_id], { title: "push.portfolioAskTitle", body: "push.portfolioAskBody", params: { n }, url: `/tasks/${dealId}`, tag: `portfolio-${dealId}` }).catch(() => undefined);
  }
  return n;
}

/** The customer's answer to all waiting requests on their task. Returns how many went public. */
export async function answerAsks(dealId: string, customerId: string, allow: boolean): Promise<number | "no"> {
  const d = await releasedDeal(dealId);
  if (!d || d.customer_id !== customerId) return "no";
  const db = createAdminClient();
  const { data } = await db.from("work_photos").select(COLS).eq("deal_id", dealId).eq("source", "helper").eq("status", "asked").returns<Row[]>();
  const rows = data ?? [];
  const now = new Date().toISOString();
  if (!allow) {
    if (rows.length) await db.from("work_photos").update({ status: "declined", decided_at: now }).in("id", rows.map((r) => r.id)).eq("status", "asked").throwOnError();
    return 0;
  }
  let n = 0;
  for (const r of rows) {
    const { data: proof } = await db.from("proofs").select("file_path, removed_at").eq("id", r.proof_id as string).maybeSingle<{ file_path: string | null; removed_at: string | null }>();
    if (!proof?.file_path || proof.removed_at) {
      await db.from("work_photos").update({ status: "removed", decided_at: now }).eq("id", r.id);
      continue;
    }
    try {
      const file = await publish(PROOF_BUCKET, proof.file_path);
      // agreed under workPhotos.consentSub, which says the price is shown
      await db.from("work_photos").update({ status: "shown", file_path: file, in_portfolio: true, show_price: true, decided_at: now }).eq("id", r.id).eq("status", "asked").throwOnError();
      n++;
    } catch (e) {
      console.error("portfolio photo publish failed", r.id, e);
    }
  }
  if (n > 0) {
    await notify([d.helper_id], { title: "push.portfolioYesTitle", body: "push.portfolioYesBody", params: { n }, url: `/helpers/${d.helper_id}`, tag: `portfolio-${dealId}` }).catch(() => undefined);
  }
  return n;
}

export interface TaskWorkPhoto {
  id: string;
  source: "review" | "helper";
  status: Status;
  url: string | null;
}

/** A task's public / requested photos, for its customer and helper (signed URLs for waiting ones). */
export async function taskWorkPhotos(dealId: string): Promise<TaskWorkPhoto[]> {
  const db = createAdminClient();
  const { data } = await db.from("work_photos").select(COLS).eq("deal_id", dealId).in("status", ["asked", "shown"]).order("created_at").returns<Row[]>();
  const rows = data ?? [];
  const asked = rows.filter((r) => r.status === "asked" && r.proof_id);
  let signed = new Map<string, string>();
  if (asked.length) {
    const { data: proofs } = await db.from("proofs").select("id, file_path").in("id", asked.map((r) => r.proof_id as string)).returns<{ id: string; file_path: string | null }[]>();
    const pathOf = new Map((proofs ?? []).filter((p) => p.file_path).map((p) => [p.id, p.file_path as string]));
    const urls = pathOf.size ? ((await db.storage.from(PROOF_BUCKET).createSignedUrls([...pathOf.values()], 3600)).data ?? []) : [];
    const byPath = new Map(urls.map((u) => [u.path, u.signedUrl]));
    signed = new Map([...pathOf].flatMap(([id, p]) => (byPath.get(p) ? [[id, byPath.get(p) as string]] : [])));
  }
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    status: r.status,
    url: r.status === "shown" && r.file_path ? publicUrl(r.file_path) : r.proof_id ? (signed.get(r.proof_id) ?? null) : null,
  }));
}

/**
 * Take a photo down: the helper (their portfolio), the task's customer (anything of their task) or
 * whoever uploaded it. The public file is deleted.
 */
export async function removeWorkPhoto(photoId: string, userId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data: r } = await db.from("work_photos").select(COLS).eq("id", photoId).maybeSingle<Row>();
  if (!r || !["asked", "shown"].includes(r.status)) return false;
  const { data: d } = await db.from("deals").select("customer_id").eq("id", r.deal_id).maybeSingle<{ customer_id: string }>();
  if (userId !== r.helper_id && userId !== r.uploaded_by && userId !== d?.customer_id) return false;
  const { data: done } = await db.from("work_photos").update({ status: "removed", removed_by: userId, decided_at: new Date().toISOString() }).eq("id", photoId).in("status", ["asked", "shown"]).select("id");
  if (!done?.length) return false;
  await unpublish(r.file_path);
  return true;
}

/** Ops takes a photo down (logged). */
export async function hideWorkPhoto(photoId: string, opsId: string, reason: string): Promise<boolean> {
  const db = createAdminClient();
  const { data: r } = await db.from("work_photos").select(COLS).eq("id", photoId).maybeSingle<Row>();
  if (!r || r.status !== "shown") return false;
  await db.from("work_photos").update({ status: "hidden", removed_by: opsId, hide_reason: reason.slice(0, 300) || null, decided_at: new Date().toISOString() }).eq("id", photoId).eq("status", "shown").throwOnError();
  await unpublish(r.file_path);
  await audit(opsId, "content.workPhoto.hide", photoId, { dealId: r.deal_id, helperId: r.helper_id, reason });
  return true;
}

/**
 * Anyone signed in reports a public photo (once each). Ops is told on the first report; at
 * AUTO_HIDE_REPORTS different people it comes down at once, before anyone looks.
 */
export async function reportWorkPhoto(photoId: string, reporterId: string, reason: ReportReason): Promise<"ok" | "already" | "no"> {
  const db = createAdminClient();
  const { data: r } = await db.from("work_photos").select(COLS).eq("id", photoId).maybeSingle<Row>();
  if (!r || r.status !== "shown") return "no";
  const { error } = await db.from("work_photo_reports").insert({ photo_id: photoId, reporter_id: reporterId, reason });
  if (error) return error.code === "23505" ? "already" : "no";
  const { count } = await db.from("work_photo_reports").select("photo_id", { count: "exact", head: true }).eq("photo_id", photoId);
  const n = count ?? 1;
  if (n >= AUTO_HIDE_REPORTS) {
    await db.from("work_photos").update({ status: "hidden", reports: n, hide_reason: "reports", decided_at: new Date().toISOString() }).eq("id", photoId).eq("status", "shown");
    await unpublish(r.file_path);
  } else {
    await db.from("work_photos").update({ reports: n }).eq("id", photoId);
  }
  if (n === 1 || n >= AUTO_HIDE_REPORTS) {
    await notify(await adminIds(), { title: "push.photoReportTitle", body: n >= AUTO_HIDE_REPORTS ? "push.photoHiddenBody" : "push.photoReportBody", url: "/ops/photos", tag: `photo-${photoId}` }).catch(() => undefined);
  }
  return "ok";
}

/* ---------- what everyone sees ---------- */

export interface WorkPhoto {
  id: string;
  url: string;
  category: CategoryId | null;
  at: number;
  source: "review" | "helper";
  helperId: string;
  /**
   * What the job finally cost for the work (after any agreed change; never the shopping) — only when
   * the customer agreed under wording that says the price is shown (`show_price`), else null.
   */
  fee: number | null;
}

export interface WorkPhotoCard extends WorkPhoto {
  helperName: string;
  rating: number | null;
}

async function toPhotos(rows: Row[]): Promise<WorkPhoto[]> {
  if (!rows.length) return [];
  const { data } = await createAdminClient()
    .from("deals")
    .select("id, category, fee")
    .in("id", [...new Set(rows.map((r) => r.deal_id))])
    .returns<{ id: string; category: CategoryId; fee: number | null }[]>();
  const deal = new Map((data ?? []).map((d) => [d.id, d]));
  return rows
    .filter((r) => r.file_path)
    .map((r) => ({ id: r.id, url: publicUrl(r.file_path as string), category: deal.get(r.deal_id)?.category ?? null, at: Date.parse(r.created_at), source: r.source, helperId: r.helper_id, fee: r.show_price ? (deal.get(r.deal_id)?.fee ?? null) : null }));
}

/** A helper's portfolio, newest first. */
export async function portfolio(helperId: string, limit = 24): Promise<WorkPhoto[]> {
  const { data } = await createAdminClient()
    .from("work_photos")
    .select(COLS)
    .eq("helper_id", helperId)
    .eq("status", "shown")
    .eq("in_portfolio", true)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  return toPhotos(data ?? []);
}

/** Up to `per` portfolio photos for each helper (cards). */
export async function portfolioThumbs(helperIds: readonly string[], per = 3): Promise<Map<string, string[]>> {
  if (!helperIds.length) return new Map();
  const { data } = await createAdminClient()
    .from("work_photos")
    .select("helper_id, file_path")
    .in("helper_id", [...helperIds])
    .eq("status", "shown")
    .eq("in_portfolio", true)
    .order("created_at", { ascending: false })
    .limit(helperIds.length * 10)
    .returns<{ helper_id: string; file_path: string | null }[]>();
  const out = new Map<string, string[]>();
  for (const r of data ?? []) {
    if (!r.file_path) continue;
    const list = out.get(r.helper_id) ?? [];
    if (list.length < per) out.set(r.helper_id, [...list, publicUrl(r.file_path)]);
  }
  return out;
}

/** The latest portfolio photos across helpers (Home, landing) — only approved helpers in good standing. */
export async function latestWork(limit = 8): Promise<WorkPhotoCard[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("work_photos")
    .select(COLS)
    .eq("status", "shown")
    .eq("in_portfolio", true)
    .order("created_at", { ascending: false })
    .limit(limit * 3)
    .returns<Row[]>();
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: people } = await db
    .from("profiles")
    .select("id, name, role, helper_status, suspended_until, rating_sum, rating_count")
    .in("id", [...new Set(rows.map((r) => r.helper_id))])
    .returns<{ id: string; name: string | null; role: string; helper_status: string | null; suspended_until: string | null; rating_sum: number; rating_count: number }[]>();
  const now = Date.now();
  const ok = new Map(
    (people ?? [])
      .filter((p) => p.role === "helper" && p.helper_status === "approved" && !(p.suspended_until && Date.parse(p.suspended_until) > now))
      .map((p) => [p.id, p]),
  );
  // at most 2 per helper, so one busy helper doesn't fill the whole row
  const perHelper = new Map<string, number>();
  const picked = rows.filter((r) => {
    if (!ok.has(r.helper_id)) return false;
    const n = perHelper.get(r.helper_id) ?? 0;
    if (n >= 2) return false;
    perHelper.set(r.helper_id, n + 1);
    return true;
  });
  const photos = await toPhotos(picked.slice(0, limit));
  return photos.map((p) => {
    const h = ok.get(p.helperId)!;
    const count = Number(h.rating_count);
    return { ...p, helperName: h.name?.trim() || "—", rating: count > 0 ? Math.round((Number(h.rating_sum) / count) * 10) / 10 : null };
  });
}

/** Review photos per task (public URLs). */
export async function reviewPhotoUrls(dealIds: readonly string[]): Promise<Map<string, string[]>> {
  if (!dealIds.length) return new Map();
  const { data } = await createAdminClient()
    .from("work_photos")
    .select("deal_id, file_path")
    .in("deal_id", [...dealIds])
    .eq("source", "review")
    .eq("status", "shown")
    .order("created_at")
    .returns<{ deal_id: string; file_path: string | null }[]>();
  const out = new Map<string, string[]>();
  for (const r of data ?? []) if (r.file_path) out.set(r.deal_id, [...(out.get(r.deal_id) ?? []), publicUrl(r.file_path)]);
  return out;
}

/** For Ops home: public photos someone reported. */
export async function reportedPhotoCount(): Promise<number> {
  const { count } = await createAdminClient().from("work_photos").select("id", { count: "exact", head: true }).eq("status", "shown").gt("reports", 0);
  return count ?? 0;
}

/** For Ops: public photos, reported ones first. */
export async function opsWorkPhotos(limit = 60): Promise<(WorkPhoto & { reports: number; dealId: string })[]> {
  const { data } = await createAdminClient()
    .from("work_photos")
    .select(COLS)
    .eq("status", "shown")
    .order("reports", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  const rows = data ?? [];
  const photos = await toPhotos(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return photos.map((p) => ({ ...p, reports: byId.get(p.id)?.reports ?? 0, dealId: byId.get(p.id)?.deal_id ?? "" }));
}
