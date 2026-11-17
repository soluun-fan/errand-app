import { expect, test } from "@playwright/test";
import { qualificationsFor } from "@/lib/qualifications";
import { NAMES, PHONES, db, loginAs, profile } from "./support";

/**
 * Care clearance for individuals (docs/decisions.md 2026-11-17): only after the criminal-record
 * check; Ops approves (interview + references reminder); then the helper qualifies for care work.
 * Care stays switched off for customers — this test never turns it on.
 */
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let batId = "";
let kycBefore = 3;

test.beforeAll(async () => {
  const bat = await profile(NAMES.bat);
  batId = bat.id;
  kycBefore = bat.kyc_level;
  await db.from("helper_certificates").delete().eq("helper_id", batId).eq("category", "childcare"); // leftovers of a cut-off run
});
test.afterAll(async () => {
  await db.from("helper_certificates").delete().eq("helper_id", batId).eq("category", "childcare");
  await db.from("profiles").update({ kyc_level: kycBefore }).eq("id", batId);
  const { data } = await db.from("category_settings").select("live").eq("category", "childcare").single();
  expect(data?.live).toBe(false); // care is still off for customers
});

async function requestClearance(page: import("@playwright/test").Page) {
  await page.goto("/helper/certificates");
  await page.getByRole("radio", { name: /Хүүхэд харах/ }).click();
  await page.locator("input[name=issuer]").fill("Ярилцлага, 2 тодорхойлогч");
  await page.locator("input[type=file]").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Нэмэгдлээ ✓")).toBeVisible();
  await page.locator("form button:not([type=button])").last().click();
}

test("without the criminal-record check, a care clearance can't even be requested", async ({ page, context }) => {
  await db.from("profiles").update({ kyc_level: 3 }).eq("id", batId);
  await loginAs(context, PHONES.bat);
  await requestClearance(page);
  await expect(page.getByText("ял шийтгэлгүй тодорхойлолтоо баталгаажуулна уу")).toBeVisible();
  const { count } = await db.from("helper_certificates").select("id", { count: "exact", head: true }).eq("helper_id", batId).eq("category", "childcare");
  expect(count).toBe(0);
});

test("with it: request → Ops approves (with the interview reminder) → qualified for babysitting", async ({ browser }) => {
  await db.from("profiles").update({ kyc_level: 4 }).eq("id", batId);
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await requestClearance(h);
  await expect.poll(async () => (await db.from("helper_certificates").select("status").eq("helper_id", batId).eq("category", "childcare").maybeSingle()).data?.status).toBe("pending");

  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/certificates");
  const card = o.locator("section", { hasText: "Ярилцлага, 2 тодорхойлогч" });
  await expect(card.getByText("видео ярилцлага")).toBeVisible(); // the care checklist
  await card.getByRole("button", { name: "Зөвшөөрөх", exact: true }).click();
  await expect.poll(async () => (await db.from("helper_certificates").select("status").eq("helper_id", batId).eq("category", "childcare").single()).data?.status).toBe("approved");

  expect((await qualificationsFor(batId, 4)).find((q) => q.category === "childcare")).toEqual({ category: "childcare", orgId: null });
  // the clearance stops counting if the background check level drops
  expect((await qualificationsFor(batId, 3)).find((q) => q.category === "childcare")).toBeUndefined();
  await Promise.all([helper.close(), ops.close()]);
});
