import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/push";
import { adminIds, audit } from "@/lib/safety";
import { SUPPORT_PER_DAY, type SupportTopic } from "@/lib/support-rules";

export interface SupportSettings { phone: string | null; email: string | null; facebook: string | null; hours: string | null }

export async function getSupportSettings(): Promise<SupportSettings> {
  const { data } = await createAdminClient().from("support_settings").select("phone, email, facebook, hours").maybeSingle<SupportSettings>();
  return data ?? { phone: null, email: null, facebook: null, hours: null };
}

export async function saveSupportSettings(opsId: string, next: SupportSettings): Promise<void> {
  const before = await getSupportSettings();
  await createAdminClient().from("support_settings").update({ ...next, updated_at: new Date().toISOString(), updated_by: opsId }).eq("id", true).throwOnError();
  await audit(opsId, "support.settings", "platform", { before, after: next });
}

/** "Message our team": saved for Ops, who get a push. Refused past the daily limit. */
export async function sendSupportRequest(userId: string, topic: SupportTopic, message: string): Promise<"sent" | "limit"> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("support_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).gt("created_at", since);
  if ((count ?? 0) >= SUPPORT_PER_DAY) return "limit";
  await db.from("support_requests").insert({ user_id: userId, topic, message }).throwOnError();
  await notify(await adminIds(), { title: "push.supportTitle", body: "push.supportBody", params: { topic }, url: "/ops/support", tag: "support" }).catch(() => undefined);
  return "sent";
}

export interface SupportRequestView { id: string; userId: string; name: string; phone: string | null; topic: SupportTopic; message: string; status: "open" | "done"; opsNote: string | null; at: number }

/** Ops inbox: open first, then the last 30 days of handled ones. Ops sees the phone to call back. */
export async function supportInbox(): Promise<SupportRequestView[]> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db.from("support_requests").select("id, user_id, topic, message, status, ops_note, created_at, profiles(name, phone)")
    .or(`status.eq.open,created_at.gt.${since}`).order("created_at", { ascending: false }).limit(200)
    .returns<{ id: string; user_id: string; topic: SupportTopic; message: string; status: "open" | "done"; ops_note: string | null; created_at: string; profiles: { name: string | null; phone: string | null } | null }[]>()
    .throwOnError();
  return (data ?? [])
    .map((r) => ({ id: r.id, userId: r.user_id, name: r.profiles?.name || "—", phone: r.profiles?.phone ?? null, topic: r.topic, message: r.message, status: r.status, opsNote: r.ops_note, at: Date.parse(r.created_at) }))
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.at - a.at);
}

export async function openSupportCount(): Promise<number> {
  const { count } = await createAdminClient().from("support_requests").select("id", { count: "exact", head: true }).eq("status", "open");
  return count ?? 0;
}

export async function closeSupportRequest(id: string, opsId: string, note: string | null): Promise<boolean> {
  const { data } = await createAdminClient().from("support_requests")
    .update({ status: "done", ops_note: note, handled_at: new Date().toISOString(), handled_by: opsId })
    .eq("id", id).eq("status", "open").select("id").returns<{ id: string }[]>().throwOnError();
  if (!data?.length) return false;
  await audit(opsId, "support.done", id, {});
  return true;
}
