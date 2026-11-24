import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, loginAs, profile, watchErrors } from "./support";

/**
 * 2026-11-24 "settle it between you": On my way, Need more time (traffic), customer not here,
 * and a partial refund after "done" — all in a real browser (run on staging).
 */
test.describe.configure({ mode: "serial" });
const created: string[] = [];
test.afterAll(async () => { await cancelIfOpen(created); });

async function paidJob(title: string) {
  const [bat, sol] = await Promise.all([profile(NAMES.bat), profile(NAMES.solongo)]);
  const now = Date.now();
  const t = createErrand({ id: crypto.randomUUID(), title, description: "x", category: "queue", mode: "now", address: "Test", location: { lat: 47.9186, lng: 106.9177 }, itemBudget: 0, fee: 20_000, customerId: sol.id }, { now, actor: actorFromProfile(sol, now) }, await pricingConfig());
  await insertDeal(db, t);
  created.push(t.deal.id);
  await runCommand(db, t.deal.id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));
  const c = await runCommand(db, t.deal.id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));
  await runCommand(db, t.deal.id, { type: "confirm_payment", providerRef: `e2e-${t.deal.id}`, amount: amountDue(c.deal) }, { kind: "provider" });
  return { id: t.deal.id, bat, sol };
}

async function pages(browser: import("@playwright/test").Browser) {
  const hc = await browser.newContext();
  await loginAs(hc, PHONES.bat);
  await hc.addCookies([{ name: "mode", value: "helper", domain: "localhost", path: "/" }]);
  const cc = await browser.newContext();
  await loginAs(cc, PHONES.solongo);
  return { h: await hc.newPage(), c: await cc.newPage(), close: () => Promise.all([hc.close(), cc.close()]) };
}

test("on my way, more time for traffic, and the customer answers 'I'm here'", async ({ browser }) => {
  const { id, bat } = await paidJob("[verify] on my way");
  const { h, c, close } = await pages(browser);
  const errors = [...watchErrors(h), ...watchErrors(c)];
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Би замдаа гарлаа" }).click();
  await expect.poll(async () => (await errand(id)).enRouteAt).not.toBeNull();
  await h.getByRole("button", { name: "+15 мин" }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Захиалагчид мэдэгдэх" }).click();
  await expect.poll(async () => (await errand(id)).arriveExtendMinutes).toBe(15);
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(/15 минут нэмж хүссэн/)).toBeVisible();

  await runCommand(db, id, { type: "start" }, actorFromProfile(bat, Date.now()));
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Захиалагч байхгүй байна" }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Захиалагчаас асуух" }).click();
  await expect.poll(async () => (await errand(id)).absentAt).not.toBeNull();
  await c.goto(`/tasks/${id}`);
  await c.getByRole("button", { name: "Би энд байна" }).click();
  await expect.poll(async () => (await errand(id)).absentAt).toBeNull();
  expect(errors).toEqual([]);
  await close();
});

test("after 'done' the customer offers a partial refund and the helper accepts it", async ({ browser }) => {
  const { id, bat, sol } = await paidJob("[verify] settle first");
  const batActor = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "start" }, batActor);
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "e2e" });
  await runCommand(db, id, { type: "finish" }, batActor);
  const { h, c, close } = await pages(browser);
  await c.goto(`/tasks/${id}`);
  await c.getByRole("button", { name: /Хэсэгчлэн буцаалт санал болгох/ }).click();
  const dlg = c.locator("dialog[open]");
  await dlg.getByRole("textbox").fill("16000");
  await dlg.getByRole("button").filter({ hasText: /илгээх|Илгээх/ }).last().click();
  await expect.poll(async () => (await errand(id)).priceChange?.fee).toBe(16_000);
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: /Зөвшөөрөх|Accept/ }).first().click();
  await expect.poll(async () => (await errand(id)).fee).toBe(16_000);
  expect((await errand(id)).status).toBe("check");
  await runCommand(db, id, { type: "confirm" }, actorFromProfile(sol, Date.now()));
  expect((await errand(id)).status).toBe("released");
  await close();
});
