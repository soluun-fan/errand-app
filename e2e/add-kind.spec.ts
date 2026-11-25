import { expect, test } from "@playwright/test";
import { insertDeal } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand, type CategoryId } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, loginAs, profile } from "./support";

/**
 * A helper opens an everyday task of a kind they haven't picked (e.g. "Дагалдах", added later):
 * one tap adds the kind to their work and applies. Bat's work kinds are restored afterwards.
 */
const created: string[] = [];
let before: CategoryId[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
  const bat = await profile(NAMES.bat);
  await db.from("profiles").update({ categories: before }).eq("id", bat.id);
});

test("a kind the helper hasn't picked: add it and apply in one tap", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  before = [...bat.categories];
  await db
    .from("profiles")
    .update({ categories: before.filter((c) => c !== "escort") })
    .eq("id", bat.id);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    {
      id: crypto.randomUUID(),
      title: "[verify] Эмнэлэг дагалдах",
      description: "x",
      category: "escort",
      mode: "now",
      address: "Test",
      itemBudget: 0,
      fee: (cfg.kindMinFee.escort ?? cfg.minFee) + 2000,
      customerId: sol.id,
    },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${t.deal.id}`);
  await expect(h.getByText(/ангиллыг профайлдаа нэмнэ үү/)).toBeVisible();
  await h.getByRole("button", { name: /ажилдаа нэмээд санал өгөх/ }).click();
  await expect.poll(async () => (await errand(t.deal.id)).offers.map((o) => o.helperId), { timeout: 30_000 }).toContain(bat.id);
  expect((await profile(NAMES.bat)).categories).toContain("escort");
  await helper.close();
});
