import { expect, test } from "@playwright/test";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { db, loginAs, watchErrors } from "./support";

/**
 * A new person, start to finish (docs/decisions.md 2026-11-18 "Registration and terms"): after the
 * SMS code they give a name and adult age confirmation and accept the Terms + Privacy policy (recorded
 * with versions); later they close their account (details removed, sign-in blocked).
 */
const phone = `9768899${String(Math.floor(Math.random() * 9000) + 1000)}`;
let userId: string | null = null;

test.afterAll(async () => {
  // the test account leaves no trace (it never had tasks)
  if (userId) await db.auth.admin.deleteUser(userId);
});

test("register (name, 18+, Terms + Privacy), use the app, then close the account", async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, phone, { fresh: true });
  const { data: p0 } = await db.from("profiles").select("id").eq("phone", phone).single<{ id: string }>();
  userId = p0!.id;
  const p = await ctx.newPage();
  const errors = watchErrors(p);

  // 1. any app page sends a new person to registration first
  await p.goto("/");
  await p.waitForURL(/\/onboarding/);
  await expect(p.getByRole("heading", { name: "Guigere апп-д тавтай морил" })).toBeVisible();

  // The age attestation is required before proceeding.
  await p.getByLabel("Таны нэр").fill("Туршилт Хэрэглэгч");
  await p.locator("input[name=terms]").check();
  await p.locator("input[name=privacy]").check();
  await p.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await expect(p.locator("input[name=age]:invalid")).toHaveCount(1);

  // 3. an adult with both documents accepted goes on to Home
  await p.locator("input[name=age]").check();
  await p.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await p.waitForURL((u) => u.pathname === "/");
  const { data: prof } = await db.from("profiles").select("name, age_confirmed_at, terms_version, privacy_version").eq("id", userId).single();
  expect(prof).toEqual({ name: "Туршилт Хэрэглэгч", age_confirmed_at: expect.any(String), terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy });
  const { data: acc } = await db.from("legal_acceptances").select("document, version").eq("user_id", userId).order("document");
  expect(acc).toEqual([
    { document: "privacy", version: LEGAL_VERSIONS.privacy },
    { document: "terms", version: LEGAL_VERSIONS.terms },
  ]);

  // 4. the documents are readable without an account
  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto("/terms");
  await expect(a.getByRole("heading", { name: "Үйлчилгээний нөхцөл" })).toBeVisible();
  await expect(a.getByText(/Ноорог/)).toBeVisible();
  await a.goto("/helper-terms");
  await expect(a.getByRole("heading", { name: "Туслагчийн үйлчилгээний гэрээ" })).toBeVisible();
  await anon.close();

  // 5. close the account: the confirmation word is required
  await p.goto("/profile");
  await p.getByRole("button", { name: "Бүртгэлээ хаах" }).click();
  const sheet = p.locator("dialog[open]");
  await sheet.locator("input[name=confirm]").fill("тийм");
  await sheet.getByRole("button", { name: "Бүртгэлээ хаах" }).click();
  await expect(sheet.getByRole("alert")).toBeVisible();
  await sheet.locator("input[name=confirm]").fill("хаах");
  await sheet.getByRole("button", { name: "Бүртгэлээ хаах" }).click();
  await p.waitForURL(/\/welcome\?closed=1/);
  await expect(p.getByText("Таны бүртгэл хаагдлаа")).toBeVisible();
  const { data: closed } = await db.from("profiles").select("name, age_confirmed_at, deleted_at").eq("id", userId).single<{ name: string; age_confirmed_at: string | null; deleted_at: string | null }>();
  expect(closed).toMatchObject({ name: "", age_confirmed_at: null });
  expect(closed!.deleted_at).not.toBeNull();
  // signed out everywhere: the app sends them to log in
  await p.goto("/profile");
  await p.waitForURL(/\/(login|welcome)/);
  expect(errors).toEqual([]);
  await ctx.close();
});
