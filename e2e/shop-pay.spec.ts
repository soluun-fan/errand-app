import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * "Buy for me" at the till (2026-11-27): the helper has the customer pay the shop by the shop's QR
 * in the chat; nothing is repaid to the helper and the item money goes back to the customer.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("the helper asks the customer to pay the shop; the customer is warned to check the receiver", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] shop pay", description: "x", category: "shop", mode: "now", address: "Test", itemBudget: 20_000, fee: 8_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  const batActor = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, batActor);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-shop-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  await runCommand(db, id, { type: "start" }, batActor);

  // the helper, at the till
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat, { mode: "helper" });
  const h = await helper.newPage();
  const hErrors = watchErrors(h);
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Захиалагчаар дэлгүүрт төлүүлэх" }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Тийм, чат нээх" }).click();
  await expect(h).toHaveURL(new RegExp(`/chat/${id}`));
  expect((await errand(id)).receiptAmount).toBe(0); // nothing to repay

  // the customer sees the check-the-receiver warning in the chat
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/chat/${id}`);
  await expect(c.getByText(/ДЭЛГҮҮР/)).toBeVisible();

  expect(hErrors).toEqual([]);
  expect(cErrors).toEqual([]);
  await Promise.all([helper.close(), customer.close()]);
});
