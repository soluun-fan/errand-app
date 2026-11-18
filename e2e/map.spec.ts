import { expect, test } from "@playwright/test";
import { insertDeal } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * Maps really draw (MapLibre's worker file is served from /vendor — scripts/copy-map-worker.mjs).
 * Guards against a library upgrade quietly breaking every map.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("a task's map loads without errors", async ({ page, context }) => {
  const sol = await profile(NAMES.solongo);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] map", description: "x", category: "queue", mode: "now", address: "Test", location: { lat: 47.918, lng: 106.917 }, itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await loginAs(context, PHONES.solongo);
  await page.goto(`/tasks/${t.deal.id}`);
  await expect(page.locator("canvas.maplibregl-canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Газрын зураг ачааллагдсангүй")).toHaveCount(0);
  expect(errors.filter((e) => /worker|maplibre/i.test(e))).toEqual([]);

  // one tap on the map opens Google Maps at the task's place (a drag would just move the map)
  const [google] = await Promise.all([page.waitForEvent("popup"), page.locator("canvas.maplibregl-canvas").first().click({ position: { x: 60, y: 200 } })]);
  await expect.poll(() => google.url(), { timeout: 20_000 }).toMatch(/google\.[a-z.]+\/maps/);
  await google.close();
  await expect(page.getByRole("link", { name: /Google Maps-д нээх/ })).toBeVisible();
});
