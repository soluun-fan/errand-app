import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * After "done" (2026-11-27, owner: "i cant tell if the job is done, neither side shows any
 * information"): a customer who is also a helper sees "confirm it" in helper mode; the helper is
 * told the job is done, the customer is checking, and when the money comes.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("both sides see a finished job: the customer (in helper mode) is asked to confirm, the helper is told what's next", async ({ browser }) => {
  const [nomin, bat] = await Promise.all([profile(NAMES.nomin), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  // Nomin is a helper who posted a task as a customer
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] finished job", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: 8000, customerId: nomin.id },
    { now, actor: actorFromProfile(nomin, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  const b = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, b);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, actorFromProfile(nomin, Date.now()));
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-fin-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  await runCommand(db, id, { type: "start" }, b);
  await runCommand(db, id, { type: "record_handover" }, b);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "e2e" });
  await runCommand(db, id, { type: "finish" }, b);

  // the customer, still in helper mode: the to-do asks them to confirm, and it opens the task
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.nomin, { mode: "helper" });
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto("/jobs");
  const todo = c.locator("section, div").filter({ hasText: "Ажлыг шалгаад баталгаажуулах" }).filter({ hasText: "[verify] finished job" }).last();
  await expect(todo).toBeVisible();
  await todo.getByRole("link").first().click();
  await expect(c).toHaveURL(new RegExp(`/tasks/${id}`));
  await expect(c.getByRole("button", { name: "Хийгдсэн, баталгаажуулах" })).toBeVisible();

  // the helper: done, the customer is checking, the amount and when
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat, { mode: "helper" });
  const h = await helper.newPage();
  const hErrors = watchErrors(h);
  await h.goto(`/jobs/${id}`);
  await expect(h.getByRole("heading", { name: "Баяр хүргэе! Ажлаа дуусгалаа" })).toBeVisible();
  await expect(h.getByText(/автоматаар баталгаажна/)).toBeVisible();
  if (process.env.SHOT_DIR) await h.screenshot({ path: `${process.env.SHOT_DIR}/helper-done.png` });
  await h.goto("/jobs");
  await expect(h.getByText("Захиалагч шалгаж байна").first()).toBeVisible();

  // the customer confirms: the helper sees it in Earnings
  await c.getByRole("button", { name: "Хийгдсэн, баталгаажуулах" }).click();
  await c.locator("dialog[open]").getByRole("button", { name: "Хийгдсэн, баталгаажуулах" }).click();
  await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("released");
  await h.goto(`/jobs/${id}`);
  await expect(h.getByRole("heading", { name: "Баталгаажлаа!" })).toBeVisible();
  await expect(h.getByText(/Захиалагч баталгаажуулсан/)).toBeVisible();
  if (process.env.SHOT_DIR) await h.screenshot({ path: `${process.env.SHOT_DIR}/helper-paid.png` });

  expect(cErrors).toEqual([]);
  expect(hErrors).toEqual([]);
  await Promise.all([customer.close(), helper.close()]);
});
