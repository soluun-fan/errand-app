import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand, type ErrandDeal } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, loginAs, profile, watchErrors } from "./support";

/**
 * 2026-11-22/23 features in a real browser (run on staging: `npm run staging:e2e`):
 *   1. a late helper → the customer gets another helper; the helper's record shows the mark
 *   2. no applications yet → "want to raise the price?" with +500₮ steps
 *   3. after a finished job the helper rates the customer (kept apart from helper ratings)
 * The clock is moved in the database (assigned_at / created_at) instead of waiting. Bat's record
 * and Solongo's customer rating are restored afterwards.
 */
test.describe.configure({ mode: "serial" });

const created: string[] = [];
let batId = "";
let solId = "";
let suspendedBefore: string | null = null;
let custRatingBefore: { customer_rating_sum: number; customer_rating_count: number } | null = null;

test.beforeAll(async () => {
  const [bat, sol] = await Promise.all([profile(NAMES.bat), profile(NAMES.solongo)]);
  batId = bat.id;
  solId = sol.id;
  suspendedBefore = bat.suspended_until ?? null;
  const { data } = await db.from("profiles").select("customer_rating_sum, customer_rating_count").eq("id", solId).single();
  custRatingBefore = data as typeof custRatingBefore;
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  if (created.length) {
    await db.from("helper_marks").delete().in("deal_id", created);
    await db.from("ratings").delete().in("deal_id", created).eq("about", "customer");
  }
  if (custRatingBefore) await db.from("profiles").update(custRatingBefore).eq("id", solId);
  await db.from("profiles").update({ suspended_until: suspendedBefore }).eq("id", batId);
});

/** A task Bat was chosen for and Solongo paid. */
async function paidJob(title: string, fee = 10_000): Promise<string> {
  const [bat, sol] = await Promise.all([profile(NAMES.bat), profile(NAMES.solongo)]);
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title, description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    await pricingConfig(),
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  await runCommand(db, t.deal.id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));
  const chosen = await runCommand(db, t.deal.id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));
  await runCommand(db, t.deal.id, { type: "confirm_payment", providerRef: `e2e-${t.deal.id}`, amount: amountDue(chosen.deal) }, { kind: "provider" });
  return t.deal.id;
}

test("a late helper: the customer gets another helper and it goes on the helper's record", async ({ browser }) => {
  const id = await paidJob("[verify] late helper");
  // chosen two hours ago: well past arrive-by (45 min) + grace (15 min)
  await db.from("deals").update({ assigned_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq("id", id);
  await runCommand(db, id, { type: "mark_late" }, { kind: "system" });
  await expect.poll(async () => (await db.from("helper_marks").select("kind").eq("deal_id", id)).data).toEqual([{ kind: "late" }]);

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(/should have arrived by|ирэх ёстой байсан/)).toBeVisible();
  await c.getByRole("button", { name: "Өөр туслагч авах" }).first().click();
  await c.locator("dialog[open]").getByRole("button", { name: "Өөр туслагч авах" }).click();
  await expect.poll(async () => (await errand(id)).status).toBe("open");
  const d = (await errand(id)) as ErrandDeal;
  expect(d.helperId).toBeNull();
  expect(d.heldAmount).toBe(0);
  await expect.poll(async () => (await db.from("helper_marks").select("kind").eq("deal_id", id)).data).toEqual([{ kind: "no_show" }]);

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  const hErrors = watchErrors(h);
  await h.goto("/helper/record");
  await expect(h.getByText("[verify] late helper")).toBeVisible();
  expect([...cErrors, ...hErrors]).toEqual([]);
  await Promise.all([customer.close(), helper.close()]);
});

test("no applications yet: the customer is asked to raise the price, in 500₮ steps", async ({ browser }) => {
  const sol = await profile(NAMES.solongo);
  const ten = Date.now() - 10 * 60_000; // posted 10 minutes ago
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] raise price", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: 8_000, customerId: sol.id },
    { now: ten, actor: actorFromProfile(sol, ten) },
    await pricingConfig(),
  );
  await insertDeal(db, t);
  created.push(t.deal.id);

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/tasks/${t.deal.id}`);
  await expect(c.getByText("Туслагч олдоогүй байна — үнээ нэмэх үү?")).toBeVisible();
  await c.getByRole("button", { name: "+500₮" }).click();
  await c.locator("dialog[open]").getByRole("button", { name: "Үнэ нэмэх" }).click();
  await expect.poll(async () => (await errand(t.deal.id)).postedFee).toBe(8_500);
  expect(cErrors).toEqual([]);
  await customer.close();
});

test("after a finished job the helper rates the customer; it never counts as a helper rating", async ({ browser }) => {
  const id = await paidJob("[verify] rate customer");
  const [bat, sol] = await Promise.all([profile(NAMES.bat), profile(NAMES.solongo)]);
  const batActor = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "start" }, batActor);
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "e2e" });
  await runCommand(db, id, { type: "finish" }, batActor);
  await runCommand(db, id, { type: "confirm" }, actorFromProfile(sol, Date.now()));
  const helperRatings = async () => (await db.from("profiles").select("rating_count").eq("id", bat.id).single<{ rating_count: number }>()).data?.rating_count;
  const helperRatingsBefore = await helperRatings();

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  await helper.addCookies([{ name: "mode", value: "helper", domain: "localhost", path: "/" }]);
  const h = await helper.newPage();
  const hErrors = watchErrors(h);
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: new RegExp(`${NAMES.solongo}.*үнэлэх`) }).click();
  const dlg = h.locator("dialog[open]");
  await dlg.getByLabel("4 од").or(dlg.locator('label:has(input[name="stars"][value="4"])')).first().click();
  await dlg.getByText("Тодорхой заавар").click();
  await dlg.getByRole("button", { name: "Үнэлгээ илгээх" }).click();
  await expect.poll(async () => (await db.from("ratings").select("stars, about").eq("deal_id", id).eq("from_user_id", bat.id)).data).toEqual([{ stars: 4, about: "customer" }]);
  expect(await helperRatings()).toBe(helperRatingsBefore);
  await h.reload();
  await expect(h.getByText(/4★/)).toBeVisible();
  expect(hErrors).toEqual([]);
  await helper.close();
});
