import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Changing photos (docs/decisions.md 2026-11-17 "Changing photos"): the customer adds / removes task
 * photos while the task is open; the helper takes back a progress photo (hidden, kept for Ops).
 */
test.describe.configure({ mode: "serial" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const UPLOAD = { timeout: 60_000 };
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

async function newTask(title: string) {
  const sol = await profile(NAMES.solongo);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title, description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  return t.deal.id;
}

test("the customer adds and removes task photos while the task is open", async ({ page, context }) => {
  const id = await newTask("[verify] photo edit");
  await loginAs(context, PHONES.solongo);
  await page.goto(`/tasks/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Зураг нэмэх").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "Ажлын зураг 1" })).toBeVisible(UPLOAD);
  expect((await db.from("task_photos").select("id").eq("deal_id", id)).data).toHaveLength(1);
  await page.getByRole("button", { name: "1-р зургийг хасах" }).click();
  await expect.poll(async () => (await db.from("task_photos").select("id").eq("deal_id", id)).data?.length, UPLOAD).toBe(0);
  await expect(page.getByRole("img", { name: "Ажлын зураг 1" })).toHaveCount(0);
});

test("the helper takes back a progress photo: the customer no longer sees it, Ops still does", async ({ browser }) => {
  const id = await newTask("[verify] proof edit");
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const batActor = actorFromProfile(bat, Date.now());
  const solActor = actorFromProfile(sol, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, batActor);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, solActor);
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await h.waitForLoadState("networkidle");
  await h.locator("input[type=file]").setInputFiles({ name: "start.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await errand(id)).status, UPLOAD).toBe("in_progress");
  await h.reload();
  await h.waitForLoadState("networkidle");
  await h.getByPlaceholder("Ж: Бараагаа авлаа, явж байна").fill("буруу зураг");
  await h.locator("input[type=file]").first().setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await db.from("proofs").select("kind").eq("deal_id", id).eq("kind", "progress")).data?.length, UPLOAD).toBe(1);
  await h.reload();
  // the start photo can't be removed; the progress photo can
  await expect(h.getByRole("button", { name: "Хасах", exact: true })).toHaveCount(1);
  await h.getByRole("button", { name: "Хасах", exact: true }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Хасах", exact: true }).click();
  await expect.poll(async () => (await db.from("proofs").select("removed_at").eq("deal_id", id).eq("kind", "progress").single()).data?.removed_at, UPLOAD).not.toBeNull();

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText("буруу зураг")).toHaveCount(0);
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto(`/tasks/${id}`);
  await expect(o.getByText("Туслагч хассан")).toBeVisible();

  // finishing still needs a handover photo that is there
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "check-out" });
  await runCommand(db, id, { type: "finish" }, batActor);
  await runCommand(db, id, { type: "confirm" }, solActor);
  await Promise.all([helper.close(), customer.close(), ops.close()]);
});
