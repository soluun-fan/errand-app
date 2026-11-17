import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Photos the customer adds when posting (docs/rules.md §Proof "Task photos"). The task doesn't exist
 * yet when they're picked, so each upload gets a row first (deal_id null); posting attaches them.
 * Files live in the PRIVATE "task-photos" bucket and are shown through 1-hour signed URLs, only to
 * people who may already see the task. Unattached uploads are deleted after a day.
 */
export const TASK_PHOTO_BUCKET = "task-photos";
export const MAX_TASK_PHOTOS = 5;
export const MAX_TASK_PHOTO_BYTES = 10 * 1024 * 1024;
/** Uploads a person may have waiting (not yet posted) — stops filling the bucket from one account. */
const MAX_LOOSE = 15;
const LOOSE_HOURS = 24;

export interface TaskPhotoSlot {
  id: string;
  path: string;
  token: string;
}

/** A signed upload URL for one JPEG (the browser re-encodes every picture to JPEG). */
export async function createTaskPhotoSlot(userId: string, bytes: number): Promise<TaskPhotoSlot | "tooMany"> {
  const db = createAdminClient();
  const since = new Date(Date.now() - LOOSE_HOURS * 3_600_000).toISOString();
  const { count } = await db.from("task_photos").select("id", { count: "exact", head: true }).eq("uploaded_by", userId).is("deal_id", null).gte("created_at", since);
  if ((count ?? 0) >= MAX_LOOSE) return "tooMany";
  const path = `u/${userId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await db.storage.from(TASK_PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  const { data: row } = await db.from("task_photos").insert({ file_path: path, bytes, uploaded_by: userId }).select("id").single().throwOnError();
  return { id: row!.id as string, path, token: data.token };
}

/**
 * Attach the customer's own waiting uploads to their new task (at most 5, only files that really
 * arrived). Returns how many were attached; the rest are left for the clean-up.
 */
export async function attachTaskPhotos(dealId: string, userId: string, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = createAdminClient();
  const { data: rows } = await db
    .from("task_photos")
    .select("id, file_path")
    .in("id", ids.slice(0, MAX_TASK_PHOTOS))
    .eq("uploaded_by", userId)
    .is("deal_id", null)
    .returns<{ id: string; file_path: string }[]>();
  if (!rows?.length) return 0;
  const { data: listed } = await db.storage.from(TASK_PHOTO_BUCKET).list(`u/${userId}`, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  const present = new Set((listed ?? []).map((f) => `u/${userId}/${f.name}`));
  const ok = rows.filter((r) => present.has(r.file_path)).map((r) => r.id);
  if (!ok.length) return 0;
  await db.from("task_photos").update({ deal_id: dealId, attached_at: new Date().toISOString() }).in("id", ok).throwOnError();
  return ok.length;
}

export interface TaskPhotoView {
  id: string;
  url: string | null;
}

/** A task's photos with signed read URLs (1 h). Call only after checking the viewer may see the task. */
export async function taskPhotosFor(dealId: string): Promise<TaskPhotoView[]> {
  const db = createAdminClient();
  const { data } = await db.from("task_photos").select("id, file_path").eq("deal_id", dealId).order("created_at").returns<{ id: string; file_path: string }[]>();
  const rows = data ?? [];
  if (!rows.length) return [];
  const signed = (await db.storage.from(TASK_PHOTO_BUCKET).createSignedUrls(rows.map((r) => r.file_path), 3600)).data ?? [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ id: r.id, url: urlOf.get(r.file_path) ?? null }));
}

/** Background job: delete uploads that were never posted (after a day), files first. */
export async function purgeLooseTaskPhotos(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const cutoff = new Date(now - LOOSE_HOURS * 3_600_000).toISOString();
  const { data } = await db.from("task_photos").select("id, file_path").is("deal_id", null).lt("created_at", cutoff).limit(200).returns<{ id: string; file_path: string }[]>();
  const rows = data ?? [];
  if (!rows.length) return 0;
  const { error } = await db.storage.from(TASK_PHOTO_BUCKET).remove(rows.map((r) => r.file_path));
  if (error) throw new Error(error.message);
  await db.from("task_photos").delete().in("id", rows.map((r) => r.id)).is("deal_id", null).throwOnError();
  return rows.length;
}

/** The first photo of each task (signed, 1 h) — for list thumbnails. Only for tasks the viewer may see. */
export async function firstPhotoUrls(dealIds: readonly string[]): Promise<Map<string, string>> {
  if (!dealIds.length) return new Map();
  const db = createAdminClient();
  const { data } = await db
    .from("task_photos")
    .select("deal_id, file_path")
    .in("deal_id", [...dealIds])
    .order("created_at")
    .returns<{ deal_id: string; file_path: string }[]>();
  const first = new Map<string, string>();
  for (const r of data ?? []) if (!first.has(r.deal_id)) first.set(r.deal_id, r.file_path);
  if (!first.size) return new Map();
  const signed = (await db.storage.from(TASK_PHOTO_BUCKET).createSignedUrls([...first.values()], 3600)).data ?? [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return new Map([...first].flatMap(([deal, path]) => (urlOf.get(path) ? [[deal, urlOf.get(path) as string]] : [])));
}
