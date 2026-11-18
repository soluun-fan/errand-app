import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile, watchErrors } from "./support";

/**
 * "Хийх зүйл" (owner, 2026-11-18: "if the app is requiring stuff, make it a path, very visible"):
 * what the app waits for is at the top of the screen, and its button opens the page to do it.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("a task waiting for payment shows on Home with a Pay button that opens it", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] todo pay", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: 12_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  await runCommand(db, t.deal.id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));
  await runCommand(db, t.deal.id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));

  const ctx = await browser.newContext();
  await loginAs(ctx, PHONES.solongo);
  const c = await ctx.newPage();
  const errors = watchErrors(c);
  await c.goto("/");
  const card = c.locator("section", { has: c.getByRole("heading", { name: /^Хийх зүйл/ }) });
  await expect(card).toBeVisible();
  const row = card.getByRole("link", { name: /Туслагчаа баталгаажуулахын тулд төлөх.*\[verify\] todo pay/ });
  await expect(row).toBeVisible();
  await row.click();
  await c.waitForURL(new RegExp(`/tasks/${t.deal.id}`));
  expect(errors).toEqual([]);
  await ctx.close();
});

test("someone not yet verified sees 'Get verified' in worker mode, and it opens the form", async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, PHONES.solongo); // a customer, never applied
  await ctx.addCookies([{ name: "mode", value: "helper", domain: "localhost", path: "/" }]);
  const p = await ctx.newPage();
  await p.goto("/jobs");
  await p.getByRole("link", { name: /Ажиллахын тулд баталгаажуулалт хийх/ }).click();
  await p.waitForURL(/\/helper\/apply/);
  await ctx.close();
});

test("tapping a kind opens that kind even with an unfinished draft of another kind", async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, PHONES.solongo);
  const p = await ctx.newPage();
  await p.goto("/post");
  await p.evaluate(() => localStorage.setItem("tuslamj:post-draft:v2", JSON.stringify({ category: "shop", title: "Old shop draft" })));
  await p.goto("/post?cat=dayjob");
  await expect(p.getByText("Түр ажил").first()).toBeVisible();
  await expect(p.getByText("Дэлгүүр · солих")).toHaveCount(0);
  await p.evaluate(() => localStorage.clear());
  await ctx.close();
});
