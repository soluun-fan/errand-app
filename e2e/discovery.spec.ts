import { expect, test } from "@playwright/test";
import { LOCALE_COOKIE, makeT, MESSAGES } from "@/i18n";
import { loginAs, PHONES, watchErrors } from "./support";

test("a visitor can close sign-in and return without losing the requested errand", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  try {
    await ctx.addCookies([{ name: LOCALE_COOKIE, value: "en", domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    const t = makeT(MESSAGES.en);
    await page.goto("/welcome");
    await page.locator("#landing-q").fill("Bring groceries after work");
    const submit = page.locator("form").getByRole("button", { name: t("landing.searchGo"), exact: true });
    await submit.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t("common.close"), exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#landing-q")).toHaveValue("Bring groceries after work");
    await submit.click();
    await dialog.getByRole("link", { name: t("landing.gateGo"), exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe("/post?title=Bring%20groceries%20after%20work");
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("the shorter customer home keeps additional services reachable by keyboard", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await loginAs(ctx, PHONES.solongo, { mode: "customer" });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });
    const service = page.locator('a[href="/post?cat=dayjob"]');
    await expect(service).toBeHidden();
    // phones show 6 kinds and a "N more" button (computers show all of them)
    const more = page.getByRole("button", { name: /Бусад үйлчилгээ|more services/i });
    await more.scrollIntoViewIfNeeded();
    await more.focus();
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.press("Enter");
    // once open, the same button reads "show fewer"
    await expect(page.getByRole("button", { name: /хураах|show fewer/i })).toHaveAttribute("aria-expanded", "true");
    await expect(service).toBeVisible();
    await service.click();
    await expect(page).toHaveURL(/\/post\?cat=dayjob$/);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
