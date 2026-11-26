import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * Disputes (2026-11-27): the customer reports a problem after "done", the money stays held, and
 * Ops decides on /ops/disputes — here a full refund, with a required note that is audited.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("a disputed task waits for Ops, who refunds the customer in full", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] dispute", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: 15_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  const batActor = actorFromProfile(bat, Date.now());
  const solActor = actorFromProfile(sol, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, batActor);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, solActor);
  const due = amountDue(await errand(id));
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-dispute-${id}`, amount: due }, { kind: "provider" });
  await runCommand(db, id, { type: "start" }, batActor);
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "e2e" });
  await runCommand(db, id, { type: "finish" }, batActor);
  expect((await errand(id)).status).toBe("check");

  // 1. the customer reports a problem from the task screen
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/tasks/${id}`);
  await c.getByRole("button", { name: "Асуудал байна" }).click();
  const sheet = c.locator("dialog[open]");
  await sheet.getByLabel("Юу болсныг бичнэ үү").fill("Дараалалд огт зогсоогүй, хүлээсэн ч ирээгүй.");
  await sheet.getByRole("button", { name: "Асуудал мэдэгдэх" }).click();
  await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("disputed");
  expect((await errand(id)).heldAmount).toBe(due); // nobody is paid while it is open

  // 2. Ops sees it, with the reason and the customer's note, and refunds in full (a note is required)
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  const oErrors = watchErrors(o);
  await o.goto("/ops");
  await o.getByRole("link", { name: /Маргаан/ }).click();
  await expect(o).toHaveURL(/\/ops\/disputes$/);
  // the card holding this task's title, its note and both decisions
  const card = o
    .locator("div, section")
    .filter({ has: o.getByRole("link", { name: "[verify] dispute" }) })
    .filter({ has: o.getByRole("button", { name: "Захиалагчид бүтнээр буцаах" }) })
    .last();
  await expect(card.getByText("Дараалалд огт зогсоогүй")).toBeVisible();
  await card.getByRole("button", { name: "Захиалагчид бүтнээр буцаах" }).click();
  const confirm = o.locator("dialog[open]");
  await confirm.getByLabel(/Шийдвэрийн тайлбар/).fill("Туслагч ирээгүй нь чатаас харагдана.");
  await confirm.getByRole("button", { name: "Захиалагчид бүтнээр буцаах" }).click();
  await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("refunded");
  expect((await errand(id)).heldAmount).toBe(0);
  const { data: log } = await db.from("ops_audit_log").select("action, data").eq("target", id).eq("action", "dispute.resolved");
  expect(log?.[0]?.data).toMatchObject({ outcome: "refund" });

  expect(cErrors).toEqual([]);
  expect(oErrors).toEqual([]);
  await Promise.all([customer.close(), ops.close()]);
});
