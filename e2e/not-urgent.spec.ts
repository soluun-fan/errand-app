import { expect, test } from "@playwright/test";
import { NAMES, PHONES, cancelIfOpen, db, errand, loginAs, profile } from "./support";

/** Not-urgent posts (docs/decisions.md 2026-11-18): open for 24 h, no set time, offers don't lapse. */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("a customer posts a not-urgent task: it stays open for 24 hours and says so on cards", async ({ browser }) => {
  const bat = await profile(NAMES.bat);
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  // a direct request to Bat, so nobody else is notified
  await c.goto(`/post?helper=${bat.id}&cat=queue&title=${encodeURIComponent("[verify] Яаралгүй ажил")}`);
  await c.evaluate(() => localStorage.clear());
  await c.locator("textarea").first().fill("Номын санд ном буцаах, өнөөдөр эсвэл маргааш");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByPlaceholder("Хаяг").fill("Төв номын сан");
  await c.getByRole("radio", { name: /Яаралгүй · 24 цаг/ }).click();
  await expect(c.getByText(/24 цаг нээлттэй байна/)).toBeVisible();
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("button", { name: /^Даалгавар нийтлэх/ }).click();
  await c.waitForURL(/\/tasks\//);
  const id = c.url().split("/tasks/")[1].split(/[?#]/)[0];
  created.push(id);

  const d = await errand(id);
  expect(d).toMatchObject({ mode: "schedule", scheduledAt: null });
  expect(Math.abs((d.matchBy as number) - (Date.now() + 24 * 3_600_000))).toBeLessThan(10 * 60_000);
  expect(d.details.autoPick).toBe(false); // compared at leisure, never auto-picked
  await expect(c.getByText(/Яаралгүй · .* хүртэл/).first()).toBeVisible();

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByText(/Яаралгүй · .* хүртэл/).first()).toBeVisible();
  const { data } = await db.from("deals").select("mode").eq("id", id).single();
  expect(data?.mode).toBe("schedule");
  await Promise.all([customer.close(), helper.close()]);
});
