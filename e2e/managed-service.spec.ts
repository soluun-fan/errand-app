import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * Managed service (docs/decisions.md 2026-11-18 "Managed service, Phase 1"): the customer pays the
 * full amount (price + service & safety fee) when choosing; after confirming, the helper's earnings
 * grow; the helper withdraws everything to their own account; Ops sends it and taps "Sent".
 */
const created: string[] = [];
let controls: { max_customer_daily: number } | null = null;
let perDay: number | null = null;

test.beforeAll(async () => {
  // today's many test payments and withdrawals would hit the daily limits: lift them for this test
  controls = (await db.from("platform_controls").select("max_customer_daily").single<{ max_customer_daily: number }>()).data;
  perDay = (await db.from("platform_rules").select("withdrawals_per_day").single<{ withdrawals_per_day: number }>()).data?.withdrawals_per_day ?? null;
  await db.from("platform_controls").update({ max_customer_daily: 100_000_000 }).eq("id", true);
  await db.from("platform_rules").update({ withdrawals_per_day: 20 }).eq("id", true);
});
test.afterAll(async () => {
  if (controls) await db.from("platform_controls").update(controls).eq("id", true);
  if (perDay !== null) await db.from("platform_rules").update({ withdrawals_per_day: perDay }).eq("id", true);
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("the customer pays the full amount; after confirming, the helper withdraws and Ops sends it", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  expect(cfg.payMode).toBe("held"); // new tasks: the full amount comes to us
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] managed service", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: 20_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  expect(t.deal.serviceFee).toBe(1500); // 20,000₮ job → 1,500₮ service & safety fee
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  const batActor = actorFromProfile(bat, Date.now());
  const solActor = actorFromProfile(sol, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, batActor);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, solActor);

  // 1. the customer pays the full 21,500₮ (simulated bank: no wire.mn key in tests)
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/tasks/${id}`);
  const sheet = c.locator("dialog[open]");
  await expect(sheet.getByText("21,500₮ төлөх")).toBeVisible();
  await sheet.getByRole("button", { name: "Khan Bank" }).click();
  await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("matched");
  expect((await errand(id)).heldAmount).toBe(amountDue(await errand(id)));
  expect((await errand(id)).heldAmount).toBe(21_500);

  // 2. the job is done and confirmed: 20,000₮ is owed to Bat, 1,500₮ is our fee
  const before = Number((await db.rpc("payable_balance", { p_user: bat.id })).data ?? 0);
  await runCommand(db, id, { type: "start" }, batActor);
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "e2e" });
  await runCommand(db, id, { type: "finish" }, batActor);
  await runCommand(db, id, { type: "confirm" }, solActor);
  expect((await errand(id)).status).toBe("released");
  const available = Number((await db.rpc("payable_balance", { p_user: bat.id })).data ?? 0);
  expect(available - before).toBe(20_000);

  // 3. Bat withdraws everything from the earnings tab
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  await helper.addCookies([{ name: "mode", value: "helper", domain: "localhost", path: "/" }]);
  const h = await helper.newPage();
  const hErrors = watchErrors(h);
  await h.goto("/earnings");
  await h.getByRole("button", { name: `${available.toLocaleString("en-US")}₮ татах` }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Татах", exact: true }).click();
  await expect
    .poll(async () => (await db.from("withdrawals").select("amount, status").eq("helper_id", bat.id).order("requested_at", { ascending: false }).limit(1).single()).data)
    .toMatchObject({ amount: available, status: "requested" });
  const { data: w } = await db.from("withdrawals").select("id, reference").eq("helper_id", bat.id).order("requested_at", { ascending: false }).limit(1).single<{ id: string; reference: string }>();
  expect(Number((await db.rpc("payable_balance", { p_user: bat.id })).data ?? 0)).toBe(0);

  // 4. Ops sees it with the full account and the reference, sends it, taps "Sent"
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/withdrawals");
  const card = o.locator("section", { hasText: w!.reference });
  await expect(card.getByText("5000004417")).toBeVisible();
  await card.getByRole("button", { name: "Шилжүүлсэн" }).click();
  await expect.poll(async () => (await db.from("withdrawals").select("status").eq("id", w!.id).single()).data?.status).toBe("sent");

  // 5. Bat sees it as sent
  await h.reload();
  await expect(h.getByText("Шилжсэн").first()).toBeVisible();
  expect([...cErrors, ...hErrors]).toEqual([]);
  await Promise.all([customer.close(), helper.close(), ops.close()]);
});
