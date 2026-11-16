import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Bargaining both ways (docs/decisions.md 2026-11-16 "Bargaining"): the helper asks more, the
 * customer answers with a price in the UI, the helper accepts it; after payment the helper
 * proposes a new price, the customer accepts and pays the difference. The ledger stays exact.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("counter-offers before matching and a price change after", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const base = cfg.minFee + 2000;
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] bargain", description: "Bargaining check", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: base, customerId: sol.id, details: { minutes: 60 } },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  await runCommand(db, id, { type: "apply", note: "", price: base + 2000 }, actorFromProfile(bat, Date.now()));

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();

  // customer answers with base + 1000
  await c.goto(`/tasks/${id}`);
  await c.getByRole("button", { name: "Үнэ санал болгох" }).click();
  await c.locator("dialog[open] input[name=price]").fill(String(base + 1000));
  await c.locator("dialog[open] form button:not([type=button])").click();
  await expect.poll(async () => (await errand(id)).offers[0]?.proposedBy).toBe("customer");

  // helper accepts the customer's price → matched, waiting for payment
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: /зөвшөөрөх$/ }).click();
  await expect.poll(async () => (await errand(id)).status).toBe("awaiting_payment");
  let d = await errand(id);
  expect(d.fee).toBe(base + 1000);

  // the bank confirms (mock webhook, as the pay button does)
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(d) }, { kind: "provider" });

  // helper proposes more after matching; customer accepts; the difference is paid
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Шинэ үнэ санал болгох" }).click();
  await h.locator("dialog[open] input[name=price]").fill(String(base + 3000));
  await h.locator("dialog[open] form button:not([type=button])").click();
  await expect.poll(async () => (await errand(id)).priceChange?.status).toBe("proposed");
  await c.goto(`/tasks/${id}`);
  await c.getByRole("button", { name: "Зөвшөөрөх" }).click();
  await expect.poll(async () => (await errand(id)).priceChange?.status).toBe("awaiting_payment");
  d = await errand(id);
  await runCommand(db, id, { type: "confirm_price", providerRef: `e2e-price-${id}`, amount: (d.priceChange?.fee ?? 0) - d.fee }, { kind: "provider" });
  // a replayed webhook changes nothing
  const replay = await runCommand(db, id, { type: "confirm_price", providerRef: `e2e-price-${id}`, amount: 2000 }, { kind: "provider" });
  expect(replay.duplicate).toBe(true);
  d = await errand(id);
  expect(d.fee).toBe(base + 3000);
  expect(d.heldAmount).toBe(amountDue({ ...d, fee: base + 3000 }));
  await Promise.all([customer.close(), helper.close()]);
});
