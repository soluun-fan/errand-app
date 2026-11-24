import "server-only";
import { loadDeal, runCommand } from "@/lib/db/deals";
import { arriveBy, helperLate } from "@/lib/engine";
import { fmtClock } from "@/lib/format";
import { notify } from "@/lib/push";
import { getRules } from "@/lib/rules";
import { adminIds } from "@/lib/safety";
import { activeMarks } from "@/lib/standards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Helper standards in the background tick (docs/decisions.md 2026-11-22). Each step is best effort
 * and idempotent: a mark exists once per job, a location reminder once until the phone sends again.
 */

/** Paid helpers who haven't started well past their arrive-by time: mark late, tell both sides. */
export async function markLateHelpers(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const { data } = await db.from("deals").select("id, helper_id")
    .eq("type", "errand").eq("status", "matched").not("helper_id", "is", null)
    .lt("assigned_at", new Date(now - 5 * 60_000).toISOString())
    .returns<{ id: string; helper_id: string }[]>().throwOnError();
  if (!data?.length) return 0;
  const { data: marked } = await db.from("helper_marks").select("deal_id, helper_id")
    .in("deal_id", data.map((d) => d.id)).returns<{ deal_id: string; helper_id: string }[]>().throwOnError();
  const done = new Set((marked ?? []).map((m) => `${m.deal_id}:${m.helper_id}`));
  let n = 0;
  for (const row of data) {
    if (done.has(`${row.id}:${row.helper_id}`)) continue;
    try {
      const d = await loadDeal(db, row.id);
      if (d?.type !== "errand" || !helperLate(d, now)) continue;
      await runCommand(db, d.id, { type: "mark_late" }, { kind: "system" });
      n++;
      const time = fmtClock(arriveBy(d) as number);
      await notify([d.helperId as string], { title: "push.lateHelperTitle", body: "push.lateHelperBody", params: { title: d.title, time }, url: `/jobs/${d.id}`, tag: `job-${d.id}` }).catch(() => undefined);
      await notify([d.customerId], { title: "push.lateCustomerTitle", body: "push.lateCustomerBody", params: { title: d.title, time }, url: `/tasks/${d.id}`, tag: `task-${d.id}` }).catch(() => undefined);
      await alertOpsIfReview(d.helperId as string);
    } catch (e) {
      console.error("mark late failed", row.id, e);
    }
  }
  return n;
}

/** When a helper's record reaches the Ops-review step, tell Ops (once per new mark). */
export async function alertOpsIfReview(helperId: string): Promise<void> {
  const [rules, marks] = await Promise.all([getRules(), activeMarks([helperId])]);
  const n = marks.get(helperId) ?? 0;
  if (n < rules.marksReview) return;
  await notify(await adminIds(), { title: "push.marksReviewTitle", body: "push.marksReviewBody", params: { n }, url: "/ops/marks", tag: `marks-${helperId}` }).catch(() => undefined);
}

/** A running job whose location stopped arriving: remind the helper once until it comes back. */
export async function nudgeStaleLocations(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const rules = await getRules();
  const { data } = await db.from("job_locations").select("deal_id, helper_id, deals!inner(status, title)")
    .is("nudged_at", null).lt("updated_at", new Date(now - rules.locationStaleMinutes * 60_000).toISOString())
    .eq("deals.status", "in_progress")
    .returns<{ deal_id: string; helper_id: string; deals: { title: string } }[]>().throwOnError();
  let n = 0;
  for (const row of data ?? []) {
    await db.from("job_locations").update({ nudged_at: new Date(now).toISOString() }).eq("deal_id", row.deal_id).is("nudged_at", null).throwOnError();
    await notify([row.helper_id], { title: "push.locationStoppedTitle", body: "push.locationStoppedBody", params: { title: row.deals.title }, url: `/jobs/${row.deal_id}`, tag: `loc-${row.deal_id}` }).catch(() => undefined);
    n++;
  }
  return n;
}

/** Job routes older than the retention days are deleted. */
export async function purgeJobRoutes(): Promise<number> {
  const { data } = await createAdminClient().rpc("purge_job_routes").throwOnError();
  return Number(data ?? 0);
}

/**
 * Privacy (2026-11-23): a helper's last position is needed only while they're working. Clear it an
 * hour after they went offline, and a day after the last sample even if they never pressed offline
 * (dispatch ignores positions older than 10 minutes anyway). Running jobs keep their own trail.
 */
export async function purgeIdlePresence(now = Date.now()): Promise<number> {
  const db = createAdminClient();
  const clear = { lat: null, lng: null };
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const [offline, forgotten] = await Promise.all([
    db.from("helper_presence").update(clear).eq("online", false).not("lat", "is", null).lt("updated_at", hourAgo).select("user_id"),
    db.from("helper_presence").update({ ...clear, online: false }).not("lat", "is", null).lt("updated_at", dayAgo).select("user_id"),
  ]);
  if (offline.error) throw offline.error;
  if (forgotten.error) throw forgotten.error;
  return (offline.data?.length ?? 0) + (forgotten.data?.length ?? 0);
}
