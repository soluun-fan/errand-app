import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Handover code (docs/decisions.md 2026-11-18 "Task conditions"): the customer gets 4 digits and
 * tells them to the helper at handover; the helper can only mark the job done after entering them.
 * Kept in a server-only table, never sent to the helper's phone. 5 wrong tries lock it for 15 min.
 */

/** For the customer's screen only. */
export async function handoverCodeFor(dealId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("handover_codes").select("code").eq("deal_id", dealId).maybeSingle<{ code: string }>();
  return data?.code ?? null;
}

export type CodeCheck = "ok" | "wrong" | "locked" | "missing";

/** The helper's attempt. On success the database lets the job be marked done. */
export async function checkHandoverCode(dealId: string, helperId: string, attempt: string): Promise<CodeCheck> {
  const { data } = await createAdminClient().rpc("check_handover_code", {
    p_deal: dealId, p_helper: helperId, p_attempt: attempt,
  }).throwOnError();
  return data;
}
