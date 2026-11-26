import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * Recommending a helper (docs/decisions.md 2026-11-25): the customer always chooses; the best-ranked
 * applicant is marked "Recommended" with why, and the list can be sorted by distance or rating.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("two applicants: one is recommended with a reason, and the customer can re-sort", async ({ browser }) => {
  const [sol, bat, nomin] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat), profile(NAMES.nomin)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    {
      id: crypto.randomUUID(),
      title: "[verify] recommend",
      description: "x",
      category: "shop",
      mode: "now",
      address: "Test",
      itemBudget: 0,
      fee: cfg.minFee + 1000,
      customerId: sol.id,
    },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  for (const h of [bat, nomin]) await runCommand(db, id, { type: "apply", note: "" }, actorFromProfile(h, Date.now()));

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText("Санал болгосон").first()).toBeVisible();
  const sort = c.getByRole("navigation", { name: "Хүсэгчдийг эрэмбэлэх" });
  await expect(sort.getByRole("link", { name: "Санал болгосон" })).toHaveAttribute("aria-current", "page");
  await sort.getByRole("link", { name: "Үнэлгээ" }).click();
  await expect(c).toHaveURL(/sort=rating/);
  await expect(sort.getByRole("link", { name: "Үнэлгээ" })).toHaveAttribute("aria-current", "page");
  // still marked after re-sorting: the recommendation doesn't move with the sort
  await expect(c.getByText("Санал болгосон").first()).toBeVisible();
  if (process.env.SHOT_DIR) await c.screenshot({ path: `${process.env.SHOT_DIR}/recommend-390.png`, fullPage: true });
  await customer.close();
});
