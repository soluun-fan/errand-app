import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * Helper listing + direct requests, end to end (docs/decisions.md 2026-11-16 "Direct requests"):
 * the helper writes an intro, a customer sends them a request through the real post flow, another
 * helper can't see or take it, the invited helper declines, and it opens to everyone.
 */
test.describe.configure({ mode: "serial" });

const created: string[] = [];
let batBefore: { bio: string | null; from_price: number | null };

test.beforeAll(async () => {
  const bat = await profile(NAMES.bat);
  batBefore = { bio: bat.bio, from_price: bat.from_price };
});

test.afterAll(async () => {
  await cancelIfOpen(created);
  const bat = await profile(NAMES.bat);
  await db.from("profiles").update(batBefore).eq("id", bat.id);
  expect(await ledgerClean()).toEqual([]);
});

test("a helper writes an intro (phones masked) and a 'from' price; under the minimum is refused", async ({ page, context }) => {
  const errors = watchErrors(page);
  const bat = await profile(NAMES.bat);
  await loginAs(context, PHONES.bat);
  await page.goto(`/helpers/${bat.id}`);
  await page.getByRole("button", { name: /Танилцуулга (нэмэх|засах)/ }).click();
  const sheet = page.locator("dialog[open]");
  await sheet.locator("textarea[name=bio]").fill("Сүхбаатар дүүрэгт амьдардаг, машинтай. Залгаарай 99112233.");
  await sheet.locator("input[name=fromPrice]").fill("8000");
  await sheet.getByRole("button", { name: "Хадгалах" }).click();
  await expect(sheet).toBeHidden();
  const saved = (await profile(NAMES.bat)) as { bio: string; from_price: number };
  expect(saved.bio).toContain("Сүхбаатар");
  expect(saved.bio).not.toContain("99112233");
  expect(saved.from_price).toBe(8000);

  await page.getByRole("button", { name: "Танилцуулга засах" }).click();
  await sheet.locator("input[name=fromPrice]").fill("100");
  await sheet.getByRole("button", { name: "Хадгалах" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Доод үнэ");
  expect(errors).toEqual([]);
});

test("a customer sends Bat a request; only Bat sees it; Bat declines and it opens to everyone", async ({ browser }) => {
  const [bat, nomin] = await Promise.all([profile(NAMES.bat), profile(NAMES.nomin)]);

  // customer: profile → "Хүсэлт илгээх" → the real post flow
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const errors = watchErrors(c);
  await c.goto(`/helpers/${bat.id}`);
  await expect(c.getByText("8,000₮-өөс")).toBeVisible();
  await c.goto(`/post?helper=${bat.id}&cat=queue&title=${encodeURIComponent("[verify] Шууд хүсэлт")}`);
  await c.evaluate(() => localStorage.clear());
  await expect(c.getByText("Bat-Erdene G.-д шууд илгээнэ")).toBeVisible();
  await c.locator("textarea").first().fill("Татварын албанд дараалалд зогсох");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("textbox", { name: "Хаана?", exact: true }).fill("Татварын газар, 1-р хороо");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await expect(c.getByText("Bat-Erdene G. боломжгүй бол бусад туслагчдад нээх")).toBeVisible();
  await c.getByRole("button", { name: /^Даалгавар нийтлэх/ }).click();
  await c.waitForURL(/\/tasks\//);
  const id = c.url().split("/tasks/")[1].split(/[?#]/)[0];
  created.push(id);
  await expect(c.getByText("Bat-Erdene G.-ийн хариуг хүлээж байна")).toBeVisible();

  const d = await errand(id);
  expect(d.invite).toMatchObject({ helperId: bat.id, openAfter: true });
  expect(d.details.autoPick).toBe(false);
  const { data: offered } = await db.from("dispatch_offers").select("helper_id").eq("deal_id", id);
  expect(offered).toEqual([{ helper_id: bat.id }]); // nobody else was notified

  // another helper who does this kind of task: can't open it, can't see it, can't apply
  const other = await browser.newContext();
  await loginAs(other, PHONES.nomin);
  const o = await other.newPage();
  // (Next streams this page, so a not-found arrives as HTTP 200 — check what is on screen)
  await o.goto(`/jobs/${id}`);
  await expect(o.getByText("could not be found")).toBeVisible();
  await expect(o.getByText("[verify] Шууд хүсэлт")).toHaveCount(0);
  const { data: feed } = await db.rpc("nearby_open_deals", { p_helper_id: nomin.id });
  expect((feed ?? []).map((r: { deal_id: string }) => r.deal_id)).not.toContain(id);
  await expect(runCommand(db, id, { type: "apply", note: "" }, actorFromProfile(nomin, Date.now()))).rejects.toThrow(/sent to one helper/);

  // Bat: sees it was sent to them, declines (no penalty) → it opens
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByText("энэ ажлыг танд шууд илгээсэн")).toBeVisible();
  await h.getByRole("button", { name: "Боломжгүй" }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Татгалзах" }).click();
  await expect.poll(async () => ((await errand(id)).invite?.until ?? Infinity) <= Date.now()).toBe(true);
  expect((await errand(id)).status).toBe("open");

  await o.goto(`/jobs/${id}`);
  await expect(o.getByText("[verify] Шууд хүсэлт")).toBeVisible();
  await c.reload();
  await expect(c.getByText("боломжгүй · бусад туслагчдад нээлээ")).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([customer.close(), other.close(), helper.close()]);
});

test("an 'only this helper' request: the customer can open it to everyone", async ({ page, context }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] Зөвхөн Bat", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 2000, customerId: sol.id, invite: { helperId: bat.id, openAfter: false } },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  await loginAs(context, PHONES.solongo);
  await page.goto(`/tasks/${t.deal.id}`);
  await page.getByRole("button", { name: "Бүх туслагчдад нээх" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Бүх туслагчдад нээх" }).click();
  await expect.poll(async () => (await errand(t.deal.id)).invite?.openAfter).toBe(true);
});

test("asking for a helper who can't take requests says so — never quietly posts to everyone", async ({ page, context }) => {
  await loginAs(context, PHONES.solongo);
  await page.goto(`/post?helper=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("Энэ туслагч одоо хүсэлт авах боломжгүй")).toBeVisible();
});
