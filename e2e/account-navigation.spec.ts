import { expect, test } from "@playwright/test";
import { LOCALE_COOKIE, makeT, MESSAGES } from "@/i18n";
import { MODE_COOKIE, modeCookieValue } from "@/lib/mode-cookie";
import { loginAs, NAMES, PHONES, profile, watchErrors } from "./support";

test("switching accounts cannot inherit another person's worker home", async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    const bat = await profile(NAMES.bat);
    await loginAs(ctx, PHONES.bat, { mode: "helper" });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/jobs$/);
    // Simulate switching sessions in the same browser with the old preference left behind.
    await loginAs(ctx, PHONES.solongo);
    expect((await ctx.cookies()).find((c) => c.name === MODE_COOKIE)?.value).toBe(modeCookieValue(bat.id, "helper"));
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    const nav = page.locator("nav:visible");
    await expect(nav.locator('a[href="/tasks"]')).toBeVisible();
    await expect(nav.locator('a[href="/profile"]')).toBeVisible();
    await page.goto("/profile");
    await expect(page.locator('button[name="mode"][value="customer"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('button[name="mode"][value="helper"]').click();
    await expect(page).toHaveURL(/\/jobs$/);
    const sol = await profile(NAMES.solongo);
    expect(decodeURIComponent((await ctx.cookies()).find((c) => c.name === MODE_COOKIE)?.value ?? "")).toBe(modeCookieValue(sol.id, "helper"));
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/tasks$/);
    // Home from a customer screen must not bounce back to the worker feed.
    const t = makeT(MESSAGES.mn);
    await page.locator("nav:visible").getByRole("button", { name: t("tabs.home"), exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/profile");
    await page.getByRole("button", { name: t("profile.signOut"), exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await ctx.cookies()).find((c) => c.name === MODE_COOKIE)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

for (const locale of ["mn", "en"] as const) {
  test(`${locale}: customer and worker navigation fits phones, tablets and enlarged text`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    try {
      await loginAs(ctx, PHONES.bat, { mode: "customer" });
      await ctx.addCookies([{ name: LOCALE_COOKIE, value: locale, domain: "localhost", path: "/" }]);
      const page = await ctx.newPage();
      const errors = watchErrors(page);
      const t = makeT(MESSAGES[locale]);
      for (const path of ["/tasks", "/jobs", "/earnings", "/profile"]) {
        await page.goto(path);
        await expect(page.locator("h1").first()).toBeVisible();
        const nav = page.getByRole("navigation", { name: t("tabs.navigation"), exact: true }).filter({ visible: true });
        const worker = path === "/jobs" || path === "/earnings";
        await expect(nav.locator(`a[href="${worker ? "/earnings" : "/tasks"}"]`)).toBeVisible();
        for (const width of [320, 390, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          for (const zoom of [1, 1.3]) {
            await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
            const size = await page.evaluate(() => ({
              scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
              wide: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((el) => `${el.tagName}.${el.getAttribute("class")}`),
            }));
            expect(size.scroll, `${locale} ${path}, ${width}px at ${zoom}: ${size.wide.join(", ")}`).toBeLessThanOrEqual(size.client + 1);
          }
        }
        await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
