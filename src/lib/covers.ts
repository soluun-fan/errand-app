import "server-only";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Example pictures per kind of work (docs/decisions.md 2026-11-17 "Pictures"): uploaded by Ops,
 * shown on cards and Home tiles when a task has no photo of its own. Generic pictures only, so the
 * bucket is public; a customer's own task photos stay in the private "task-photos" bucket.
 */
export const COVER_BUCKET = "kind-covers";

/** Public URL per kind that has a cover. */
export async function kindCovers(): Promise<Map<CategoryId, string>> {
  const db = createAdminClient();
  const { data } = await db.from("category_settings").select("category, cover_path").not("cover_path", "is", null).returns<{ category: CategoryId; cover_path: string }[]>();
  return new Map((data ?? []).map((r) => [r.category, db.storage.from(COVER_BUCKET).getPublicUrl(r.cover_path).data.publicUrl]));
}

/** Ops only (the caller checks): a signed upload URL for a new cover of this kind. */
export async function createCoverSlot(category: CategoryId): Promise<{ path: string; token: string }> {
  if (!CATEGORIES.some((c) => c.id === category)) throw new Error("Unknown kind");
  const path = `${category}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await createAdminClient().storage.from(COVER_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, token: data.token };
}

/** Ops only: set (or clear, with null) a kind's cover; the old file is removed. Logged. */
export async function setCover(opsId: string, category: CategoryId, path: string | null): Promise<boolean> {
  const db = createAdminClient();
  if (path !== null) {
    if (!path.startsWith(`${category}/`)) return false;
    const name = path.slice(category.length + 1);
    const { data: listed } = await db.storage.from(COVER_BUCKET).list(category, { search: name, limit: 1 });
    if (!listed?.some((f) => f.name === name)) return false; // the upload must really be there
  }
  const { data: before } = await db.from("category_settings").select("cover_path").eq("category", category).single<{ cover_path: string | null }>();
  await db.from("category_settings").update({ cover_path: path }).eq("category", category).throwOnError();
  if (before?.cover_path && before.cover_path !== path) await db.storage.from(COVER_BUCKET).remove([before.cover_path]);
  await audit(opsId, path ? "content.cover.set" : "content.cover.clear", category, { path });
  return true;
}
