import { expect, test } from "@playwright/test";
import { insertDeal } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * Rules from the database (docs/decisions.md 2026-11-18): Ops changes a timing at /ops/rules, it's
 * logged, and new tasks copy it; the setting is put back at the end.
 */
const created: string[] = [];
let before = 10;
test.beforeAll(async () => {
  before = (await db.from("platform_rules").select("payment_window_minutes").single()).data?.payment_window_minutes ?? 10;
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  await db.from("platform_rules").update({ payment_window_minutes: before }).eq("id", true);
});

test("Ops sets the payment window; new tasks carry it", async ({ page, context }) => {
  await loginAs(context, PHONES.ops);
  await page.goto("/ops/rules");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Сонгосны дараа төлөх хугацаа").fill("15");
  await page.getByRole("button", { name: "Дүрэм хадгалах" }).click();
  await expect(page.getByText("Хадгаллаа. Шинэ даалгавар энэ дүрмээр явна.")).toBeVisible();
  expect((await db.from("platform_rules").select("payment_window_minutes").single()).data?.payment_window_minutes).toBe(15);
  const { data: log } = await db.from("ops_audit_log").select("action").eq("action", "rules.update").order("created_at", { ascending: false }).limit(1);
  expect(log?.[0]?.action).toBe("rules.update");

  // a task posted now copies the 15 minutes
  const sol = await profile(NAMES.solongo);
  const cfg = await pricingConfig();
  expect(cfg.paymentWindowMinutes).toBe(15);
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] rules", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  const { data } = await db.from("deals").select("details").eq("id", t.deal.id).single();
  expect((data?.details as { rules?: { paymentWindowMinutes: number } }).rules?.paymentWindowMinutes).toBe(15);

  // nonsense is refused with a clear message
  await page.getByLabel("Сонгосны дараа төлөх хугацаа").fill("0");
  await page.getByRole("button", { name: "Дүрэм хадгалах" }).click();
  await expect(page.getByText(/3–60 хоорондох бүхэл тоо/)).toBeVisible();
});
