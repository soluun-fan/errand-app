import { expect, test } from "@playwright/test";
import { insertDeal } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * Pictures (docs/decisions.md 2026-11-17 "Pictures"): Ops adds a cover picture for a kind → Home's
 * tile and the helper's cards show it, marked "Жишээ" (example). Removed again at the end.
 */
test.describe.configure({ mode: "serial" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const created: string[] = [];
let coverBefore: string | null = null;

test.beforeAll(async () => {
  const { data } = await db.from("category_settings").select("cover_path").eq("category", "queue").single();
  coverBefore = data?.cover_path ?? null;
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  const { data } = await db.from("category_settings").select("cover_path").eq("category", "queue").single();
  if (data?.cover_path && data.cover_path !== coverBefore) {
    await db.storage.from("kind-covers").remove([data.cover_path]);
    await db.from("category_settings").update({ cover_path: coverBefore }).eq("category", "queue");
  }
});

test("Ops adds a cover for 'Дараалал'; Home and the helper's card show it as an example", async ({ browser }) => {
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/content");
  await o.waitForLoadState("networkidle"); // the page's scripts must be running before a file is picked
  await o.getByLabel("Дараалал-ийн зураг").setInputFiles({ name: "queue.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await db.from("category_settings").select("cover_path").eq("category", "queue").single()).data?.cover_path, { timeout: 60_000 }).toMatch(/^queue\/[0-9a-f-]{36}\.jpg$/);
  const { data: log } = await db.from("ops_audit_log").select("action").eq("target", "queue").order("created_at", { ascending: false }).limit(1);
  expect(log?.[0]?.action).toBe("content.cover.set");

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto("/");
  await expect(c.locator('a[href="/post?cat=queue"] img')).toBeVisible();

  // a queue task without photos: the helper's card shows the cover, marked as an example
  const [sol] = await Promise.all([profile(NAMES.solongo)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] Дараалалд зогсох", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto("/jobs?view=all&cat=queue&sort=new");
  const card = h.locator(`a[href="/jobs/${t.deal.id}"]`);
  await expect(card.locator("img")).toBeVisible();
  await expect(card.getByText("Жишээ")).toBeVisible();
  await Promise.all([ops.close(), customer.close(), helper.close()]);
});
