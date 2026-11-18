import "server-only";
import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Handover code (docs/decisions.md 2026-11-18 "Task conditions"): the customer gets 4 digits and
 * tells them to the helper at handover; the helper can only mark the job done after entering them.
 * Kept in a server-only table, never sent to the helper's phone. 5 wrong tries lock it for 15 min.
 */
export const MAX_CODE_TRIES = 5;
const LOCK_MS = 15 * 60_000;

export async function createHandoverCode(dealId: string): Promise<void> {
  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  await createAdminClient().from("handover_codes").upsert({ deal_id: dealId, code }, { onConflict: "deal_id", ignoreDuplicates: true }).throwOnError();
}

/** For the customer's screen only. */
export async function handoverCodeFor(dealId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("handover_codes").select("code").eq("deal_id", dealId).maybeSingle<{ code: string }>();
  return data?.code ?? null;
}

export type CodeCheck = "ok" | "wrong" | "locked" | "missing";

/** The helper's attempt. On success the database lets the job be marked done. */
export async function checkHandoverCode(dealId: string, attempt: string, now = Date.now()): Promise<CodeCheck> {
  const db = createAdminClient();
  const { data } = await db.from("handover_codes").select("code, verified_at, failed_attempts, locked_until").eq("deal_id", dealId).maybeSingle<{ code: string; verified_at: string | null; failed_attempts: number; locked_until: string | null }>();
  if (!data) return "missing";
  if (data.verified_at) return "ok";
  if (data.locked_until && Date.parse(data.locked_until) > now) return "locked";
  if (/^\d{4}$/.test(attempt) && attempt === data.code) {
    await db.from("handover_codes").update({ verified_at: new Date(now).toISOString(), failed_attempts: 0, locked_until: null }).eq("deal_id", dealId).throwOnError();
    return "ok";
  }
  const tries = data.failed_attempts + 1;
  const lock = tries >= MAX_CODE_TRIES;
  await db
    .from("handover_codes")
    .update({ failed_attempts: lock ? 0 : tries, locked_until: lock ? new Date(now + LOCK_MS).toISOString() : null })
    .eq("deal_id", dealId)
    .throwOnError();
  return lock ? "locked" : "wrong";
}
