import "server-only";
import { loadDeal } from "@/lib/db/deals";
import { publicProfiles } from "@/lib/deals/queries";
import type { ErrandDeal } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DisputeMessage {
  from: "customer" | "helper" | "system";
  text: string;
  at: number;
  photo: boolean;
}

export interface OpenDispute {
  deal: ErrandDeal;
  customerName: string;
  helperName: string;
  reason: string;
  note: string;
  openedAt: number;
  /** The task's conversation with the chosen helper, newest last (already contact-masked when sent). */
  messages: DisputeMessage[];
}

/**
 * Tasks waiting for an Ops decision (status `disputed`), oldest first — the money stays held until
 * Ops releases it to the helper or refunds the customer (docs/screens-helper-ops.md "Disputes").
 */
export async function openDisputes(limit = 50): Promise<OpenDispute[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("deals")
    .select("id")
    .eq("type", "errand")
    .eq("status", "disputed")
    .order("updated_at")
    .limit(limit)
    .throwOnError();
  const deals = (await Promise.all((data ?? []).map((r) => loadDeal(db, r.id as string)))).filter(
    (d): d is ErrandDeal => d !== null && d.type === "errand" && d.status === "disputed",
  );
  if (!deals.length) return [];
  const names = await publicProfiles(deals.flatMap((d) => [d.customerId, d.helperId]));
  const threads = await Promise.all(
    deals.map(async (d) => {
      if (!d.helperId) return [];
      const { data: rows } = await db
        .from("messages")
        .select("from_user_id, text, is_system, created_at, image_path, audio_path")
        .eq("deal_id", d.id)
        .eq("helper_id", d.helperId)
        .order("created_at", { ascending: false })
        .limit(40)
        .throwOnError();
      return (rows ?? []).reverse().map((m): DisputeMessage => ({
        from: m.is_system || !m.from_user_id ? "system" : m.from_user_id === d.customerId ? "customer" : "helper",
        text: m.text,
        at: Date.parse(m.created_at),
        photo: Boolean(m.image_path || m.audio_path),
      }));
    }),
  );
  return deals.map((d, i) => ({
    deal: d,
    customerName: names.get(d.customerId)?.name || "—",
    helperName: (d.helperId && names.get(d.helperId)?.name) || "—",
    reason: d.dispute?.reason ?? "",
    note: d.dispute?.note ?? "",
    openedAt: d.dispute?.at ?? 0,
    messages: threads[i],
  }));
}

/** How many tasks are waiting for a dispute decision (the Ops home badge). */
export async function openDisputeCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("type", "errand")
    .eq("status", "disputed")
    .throwOnError();
  return count ?? 0;
}
