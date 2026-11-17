import { expect, test, type Browser } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Backing out (docs/decisions.md 2026-11-17 "Backing out"): the chosen helper backs out → the
 * customer is refunded and the task is open again. Free within 10 minutes of being chosen; later
 * the helper is paused (1st time in 30 days: 1 day). Bat's account is restored afterwards.
 */
test.describe.configure({ mode: "serial" });

const created: string[] = [];
let batId = "";
let suspendedBefore: string | null = null;
const startedAt = new Date().toISOString();

test.beforeAll(async () => {
  const bat = await profile(NAMES.bat);
  batId = bat.id;
  suspendedBefore = bat.suspended_until ?? null;
  const { count } = await db.from("helper_penalties").select("id", { count: "exact", head: true }).eq("helper_id", batId);
  expect(count, "Bat should have no back-outs on record before this test").toBe(0);
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  await db.from("helper_penalties").delete().eq("helper_id", batId).gte("created_at", startedAt);
  await db.from("profiles").update({ suspended_until: suspendedBefore }).eq("id", batId);
  expect(await ledgerClean()).toEqual([]);
});

/** A paid task with Bat chosen; `minutesAgo` moves the moment he was chosen into the past. */
async function paidTaskForBat(minutesAgo: number): Promise<string> {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] back out", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  await runCommand(db, id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));
  await runCommand(db, id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  if (minutesAgo) await db.from("deals").update({ assigned_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).eq("id", id).throwOnError();
  expect((await errand(id)).status).toBe("matched");
  return id;
}

async function backOutAsBat(browser: Browser, id: string, expectText: string) {
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Татгалзах", exact: true }).first().click();
  const sheet = h.locator("dialog[open]");
  await expect(sheet.getByText(expectText)).toBeVisible();
  await sheet.getByRole("button", { name: "Татгалзах", exact: true }).click();
  await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("open");
  await helper.close();
}

test("within 10 minutes: free — refunded, open again, no pause", async ({ browser }) => {
  const id = await paidTaskForBat(0);
  await backOutAsBat(browser, id, "торгуульгүй");
  const d = await errand(id);
  expect(d).toMatchObject({ status: "open", helperId: null, heldAmount: 0 });
  expect(d.offers.map((o) => o.helperId)).not.toContain(batId);
  const { count } = await db.from("helper_penalties").select("id", { count: "exact", head: true }).eq("helper_id", batId);
  expect(count).toBe(0);
  expect((await profile(NAMES.bat)).suspended_until ?? null).toBe(suspendedBefore);
});

test("after 10 minutes: refunded and posted anew; Bat is paused for 1 day; the customer sees why", async ({ browser }) => {
  const id = await paidTaskForBat(15);
  await backOutAsBat(browser, id, "1 хоног");
  const d = await errand(id);
  expect(d).toMatchObject({ status: "open", helperId: null, heldAmount: 0, assignedAt: null });
  expect(d.matchBy).toBeGreaterThan(Date.now() + 20 * 60_000); // a fresh search window

  const { data: refunds } = await db.from("ledger_entries").select("kind, amount").eq("deal_id", id).eq("kind", "refund");
  expect(refunds?.length).toBe(1);
  const { data: pen } = await db.from("helper_penalties").select("pause_days, nth_in_30d").eq("deal_id", id);
  expect(pen).toEqual([{ pause_days: 1, nth_in_30d: 1 }]);
  const until = Date.parse((await profile(NAMES.bat)).suspended_until as string);
  expect(Math.abs(until - (Date.now() + 86_400_000))).toBeLessThan(10 * 60_000);
  const { data: offer } = await db.from("dispatch_offers").select("status").eq("deal_id", id).eq("helper_id", batId).maybeSingle();
  if (offer) expect(offer.status).toBe("declined"); // never offered to him again

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(/татгалзлаа · мөнгө буцаагдаж/).first()).toBeVisible();
  await customer.close();
});
