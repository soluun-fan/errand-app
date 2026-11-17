import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { DEFAULT_DETAILS, amountDue, createErrand, taskMinFee } from "@/lib/engine";
import { qualificationsFor } from "@/lib/qualifications";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Specialized work end to end (docs/decisions.md 2026-11-16 "Specialized work"): a helper
 * registers a company through the real form, Ops approves it for plumbing, a plumbing task goes to
 * that company's worker only, and the release pays the company, not the worker. Care stays off.
 */
test.describe.configure({ mode: "serial" });

// 1×1 PNG, standing in for a scanned registration certificate
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const REG = `9${String(Date.now()).slice(-6)}`; // a fresh 7-digit number per run
const created: string[] = [];
let orgId = "";

test.afterAll(async () => {
  await cancelIfOpen(created);
  // the test company is left suspended (its paid test job keeps its ledger history)
  if (orgId) await db.from("organizations").update({ status: "suspended", review_note: "[verify] e2e" }).eq("id", orgId);
  expect(await ledgerClean()).toEqual([]);
});

test("a helper registers a company with its certificate; Ops approves it for plumbing", async ({ browser }) => {
  const bat = await profile(NAMES.bat);
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto("/orgs/new");
  await h.locator("input[name=name]").fill(`[verify] Ус Сантехник ${REG}`);
  await h.locator("input[name=regNumber]").fill(REG);
  await h.getByRole("checkbox", { name: /Сантехник/ }).click();
  await h.locator("input[type=file]").setInputFiles({ name: "certificate.png", mimeType: "image/png", buffer: PNG });
  await expect(h.getByText("Нэмэгдлээ ✓")).toBeVisible();
  await h.locator("select[name=bank]").selectOption({ index: 1 });
  await h.locator("input[name=accountNumber]").fill("5000123456");
  await h.locator("input[name=holderName]").fill("Ус Сантехник ХХК");
  await h.locator("input[type=checkbox]").last().check(); // consent
  await h.locator("form button:not([type=button])").last().click();
  await h.waitForURL(/\/profile/);
  const { data: org } = await db.from("organizations").select("id, status, owner_id").eq("reg_number", REG).single();
  expect(org).toMatchObject({ status: "pending", owner_id: bat.id });
  orgId = org!.id;
  const { data: payout } = await db.from("organization_payout_accounts").select("account_number").eq("org_id", orgId).single();
  expect(payout?.account_number).toBe("5000123456"); // saved together with the registration

  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto(`/ops/orgs/${orgId}`);
  await o.getByRole("button", { name: "Зөвшөөрөх", exact: true }).click();
  await expect.poll(async () => (await db.from("organizations").select("status").eq("id", orgId).single()).data?.status).toBe("approved");
  // the owner is now an active worker of the company for plumbing
  expect((await qualificationsFor(bat.id, bat.kyc_level)).find((q) => q.category === "plumbing")).toEqual({ category: "plumbing", orgId });
  await Promise.all([helper.close(), ops.close()]);
});

test("a plumbing job: only the company's worker can take it, and the company is paid", async ({ browser }) => {
  const [sol, bat, nomin] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat), profile(NAMES.nomin)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] Угаалтуурын хоолой", description: "Хоолой гоожиж байна", category: "plumbing", mode: "now", address: "Test", itemBudget: 0, fee: taskMinFee("plumbing", DEFAULT_DETAILS, now, cfg) + 5000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  expect(t.deal.checkHours).toBe(72); // a leak shows up later: longer check window

  // Nomin isn't qualified: not in her feed, and the engine refuses her
  const { data: feed } = await db.rpc("nearby_open_deals", { p_helper_id: nomin.id });
  expect((feed ?? []).map((r: { deal_id: string }) => r.deal_id)).not.toContain(id);
  await expect(runCommand(db, id, { type: "apply", note: "" }, actorFromProfile(nomin, Date.now()))).rejects.toThrow(/certificate or an approved organisation/);

  // Bat applies through the job page; the offer carries the company
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByText(/Ус Сантехник/).first()).toBeVisible(); // "paid to the company"
  await h.getByRole("button", { name: /^Хийж чадна/ }).click();
  await expect.poll(async () => (await errand(id)).offers[0]?.orgId).toBe(orgId);

  // customer chooses, pays (mock bank), Bat does the job, customer confirms → the company is paid
  const solActor = actorFromProfile(sol, Date.now());
  const batActor = { ...actorFromProfile(bat, Date.now()), qualified: await qualificationsFor(bat.id, bat.kyc_level) };
  await runCommand(db, id, { type: "choose", helperId: bat.id }, solActor);
  let d = await errand(id);
  expect(d.payeeOrgId).toBe(orgId);
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(d) }, { kind: "provider" });
  await runCommand(db, id, { type: "start" }, batActor);
  await runCommand(db, id, { type: "record_handover" }, batActor).catch(() => undefined);
  await runCommand(db, id, { type: "finish" }, batActor);
  await runCommand(db, id, { type: "confirm" }, solActor);
  d = await errand(id);
  expect(d.status).toBe("released");
  const { data: rows } = await db.from("ledger_entries").select("kind, to_account, amount").eq("deal_id", id);
  expect(rows?.some((r) => r.kind === "release_fee" && r.to_account === `payable:${orgId}`)).toBe(true);
  expect(rows?.some((r) => r.to_account === `payable:${bat.id}`)).toBe(false);

  // the customer's breakdown names the company; the service fee keeps its own label
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(/Ус Сантехник/).first()).toBeVisible();
  await Promise.all([helper.close(), customer.close()]);
});

test("care work is off: not offered to customers, and the database refuses it", async ({ page, context }) => {
  const sol = await profile(NAMES.solongo);
  await loginAs(context, PHONES.solongo);
  await page.goto("/post");
  await expect(page.getByText("Хүүхэд харах")).toHaveCount(0);
  await expect(page.getByText("Сантехник").first()).toBeVisible();
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    // tomorrow 10:00 Ulaanbaatar (care is daytime only) at a price above any floor: only "switched off" can refuse it
    { id: crypto.randomUUID(), title: "[verify] care", description: "x", category: "childcare", mode: "now", scheduledAt: (Math.floor((now + 8 * 3_600_000) / 86_400_000) + 1) * 86_400_000 + 2 * 3_600_000, address: "Test", itemBudget: 0, fee: 200_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await expect(insertDeal(db, t)).rejects.toThrow(/not available/);
});

test("helpers can pick the new everyday kinds on their profile", async ({ page, context }) => {
  const nomin = await profile(NAMES.nomin);
  const before = nomin.categories;
  await loginAs(context, PHONES.nomin);
  await page.goto("/profile");
  await page.locator("label", { hasText: "Хог" }).click();
  await page.getByRole("button", { name: "Хадгалах" }).first().click();
  await expect.poll(async () => (await profile(NAMES.nomin)).categories).toContain("trash");
  await db.from("profiles").update({ categories: before }).eq("id", nomin.id);
});
