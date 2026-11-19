import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Task conditions (docs/decisions.md 2026-11-18): a task needing a driver's licence and a handover
 * code. Bat can't apply until Ops checks his licence; he finishes only with the customer's code.
 * Bat's licence record is removed afterwards.
 */
test.describe.configure({ mode: "serial" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const created: string[] = [];
let batId = "";
test.beforeAll(async () => {
  batId = (await profile(NAMES.bat)).id;
  await db.from("helper_badges").delete().eq("helper_id", batId);
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  await db.from("helper_badges").delete().eq("helper_id", batId);
  expect(await ledgerClean()).toEqual([]);
});

test("a licence-only task: Bat sends his licence, Ops approves, then he can apply; finishing needs the customer's code", async ({ browser }) => {
  const sol = await profile(NAMES.solongo);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] Машинтай хүргэлт", description: "x", category: "deliver", mode: "now", address: "Private destination 930", pickupAddress: "Private pickup 284", itemBudget: 0, fee: cfg.minFee + 3000, customerId: sol.id, details: { require: { driver: true, handoverCode: true } } as never },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  await db.from("handover_codes").update({ code: "4821" }).eq("deal_id", id).throwOnError();

  // Bat sees the condition he's missing, and no apply button
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByText(/Жолооны үнэмлэх ✕/)).toBeVisible();
  await expect(h.getByRole("button", { name: /^Хийж чадна/ })).toHaveCount(0);

  // he sends his licence; Ops approves it
  await h.goto("/helper/badges");
  await h.waitForLoadState("networkidle");
  const form = h.locator("form", { hasText: "Үнэмлэхийн дугаар" });
  await form.locator("input[name=number]").fill("AA123456");
  await form.locator("input[name=classes]").fill("B");
  await form.locator("input[type=file]").setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: PNG });
  await expect(form.getByText("Нэмэгдлээ ✓")).toBeVisible({ timeout: 60_000 });
  await form.getByRole("button", { name: "Шалгуулахаар илгээх" }).click();
  await expect.poll(async () => (await db.from("helper_badges").select("status").eq("helper_id", batId).eq("kind", "driver").maybeSingle()).data?.status).toBe("pending");
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/badges");
  await o.locator("article, section, div", { hasText: "AA123456" }).getByRole("button", { name: "Зөвшөөрөх", exact: true }).last().click();
  await expect.poll(async () => (await db.from("helper_badges").select("status").eq("helper_id", batId).eq("kind", "driver").single()).data?.status).toBe("approved");

  // now he can apply
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: /^Хийж чадна/ }).click();
  await expect.poll(async () => (await errand(id)).offers.map((x) => x.helperId)).toContain(batId);

  await h.goto(`/tasks/${id}`);
  await expect(h).toHaveURL(new RegExp(`/jobs/${id}$`));
  const applicantPage = await h.content();
  expect(applicantPage).not.toContain("Private pickup 284");
  expect(applicantPage).not.toContain("Private destination 930");

  // chosen, paid, job done — finishing needs the code
  const bat = await profile(NAMES.bat);
  await runCommand(db, id, { type: "choose", helperId: batId }, actorFromProfile(sol, Date.now()));
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  const b = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "start" }, b);
  await runCommand(db, id, { type: "record_handover" }, b);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: batId, note: "check-out" });

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText("4821")).toBeVisible(); // the customer sees their code

  await h.goto(`/jobs/${id}`);
  await expect(h.getByText("4821")).toHaveCount(0); // never on the helper's screen
  await h.locator("input[name=code]").fill("1111");
  await h.getByRole("button", { name: /Дууссан гэж/ }).click();
  await expect(h.getByText(/Код буруу байна/)).toBeVisible();
  expect((await errand(id)).status).toBe("in_progress");
  await h.locator("input[name=code]").fill("4821");
  await h.getByRole("button", { name: /Дууссан гэж/ }).click();
  await expect.poll(async () => (await errand(id)).status).toBe("check");
  await runCommand(db, id, { type: "confirm" }, actorFromProfile(sol, Date.now()));
  await Promise.all([helper.close(), ops.close(), customer.close()]);
});
