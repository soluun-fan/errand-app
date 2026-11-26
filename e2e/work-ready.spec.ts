import { expect, test } from "@playwright/test";
import { PHONES, loginAs } from "./support";

/**
 * Phone, location, notifications (owner, 2026-11-18): without them a helper sees the "get ready"
 * checklist instead of the online switch. These tests remove the test-browser bypass cookie.
 */
test("on a computer: 'use your phone', and no online switch", async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, PHONES.bat, { mode: "helper" });
  await ctx.clearCookies({ name: "e2e-device" });
  const p = await ctx.newPage();
  await p.goto("/jobs");
  await expect(p.getByRole("heading", { name: "Ажиллахад бэлдэх" })).toBeVisible();
  await expect(p.getByText(/Ажиллахын тулд Guigere апп-ыг утсаараа/)).toBeVisible();
  await expect(p.getByRole("switch")).toHaveCount(0);
  await ctx.close();
});

test("on a phone with location allowed: location turns green; notifications still needed", async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 47.918, longitude: 106.917 },
    permissions: ["geolocation"],
  });
  await loginAs(ctx, PHONES.bat, { mode: "helper" });
  await ctx.clearCookies({ name: "e2e-device" });
  const p = await ctx.newPage();
  await p.goto("/jobs");
  const card = p.locator("section", { has: p.getByRole("heading", { name: "Ажиллахад бэлдэх" }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Энэ бол утас ✓")).toBeVisible();
  await expect(card.getByRole("button", { name: "Байршил асаах" })).toHaveCount(0); // already allowed → sent
  await expect(card.getByText("Мэдэгдэл асаах").first()).toBeVisible();
  await expect(p.getByRole("switch")).toHaveCount(0);
  await ctx.close();
});

test("Ops lets a helper work from a computer: the phone step is done, the other steps remain", async ({ browser }) => {
  // Ops turns it on from the All helpers list
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/helpers");
  const row = o.locator("li").filter({ hasText: "Bat-Erdene G." }).first();
  try {
    await row.getByRole("button", { name: "Компьютерээс ажиллуулах" }).click();
    await expect(row.getByRole("button", { name: /Компьютер ✓/ })).toBeVisible();

    const ctx = await browser.newContext({ geolocation: { latitude: 47.918, longitude: 106.917 }, permissions: ["geolocation"] });
    await loginAs(ctx, PHONES.bat, { mode: "helper" });
    await ctx.clearCookies({ name: "e2e-device" });
    const p = await ctx.newPage();
    await p.goto("/jobs");
    await expect(p.getByText("Ops танд компьютерээс ажиллахыг зөвшөөрсөн ✓")).toBeVisible();
    await expect(p.getByText(/Ажиллахын тулд Guigere апп-ыг утсаараа/)).toHaveCount(0);
    await ctx.close();
  } finally {
    // back to the default for the other tests
    await o.reload();
    const off = o.locator("li").filter({ hasText: "Bat-Erdene G." }).first().getByRole("button", { name: /Компьютер ✓/ });
    if (await off.count()) await off.click();
    await ops.close();
  }
});
