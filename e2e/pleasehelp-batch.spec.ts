import { expect, test } from "@playwright/test";
import { insertDeal } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * The 2026-11-26 batch (docs/decisions.md): one or two places, tap-to-fill descriptions, contactless
 * jobs, customer ID checks for jobs in a home, Ops "send back for re-check", helper experience/transport.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("post form: tap-to-fill, one or two places, contactless", async ({ browser }) => {
  const c = await browser.newContext();
  await loginAs(c, PHONES.solongo);
  const p = await c.newPage();
  await p.goto("/post?cat=queue");
  await p.getByRole("button", { name: /Паспортын албанд дараалалд зогсож өгнө үү/ }).click();
  await expect(p.locator("#task-brief")).toHaveValue("Паспортын албанд дараалалд зогсож өгнө үү");
  await p.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  const places = p.getByRole("radiogroup", { name: "Хэдэн газар хамаарах вэ?" });
  await expect(places.getByRole("radio", { name: "Нэг газар" })).toHaveAttribute("aria-checked", "true");
  await expect(p.getByText("Авах хаяг")).toHaveCount(0);
  await places.getByRole("radio", { name: "Авах → хүргэх" }).click();
  await expect(p.getByText("Авах хаяг").first()).toBeVisible();
  await expect(p.getByText("Уулзахгүйгээр хийж болно")).toBeVisible();
  await c.close();
});

test("a job in someone's home asks for an ID check first", async ({ browser }) => {
  const c = await browser.newContext();
  await loginAs(c, PHONES.solongo);
  const p = await c.newPage();
  await p.goto("/post?cat=repair");
  await expect(p.getByText("Энэ ажлыг захиалахын өмнө иргэний үнэмлэхээ шалгуулна уу.")).toBeVisible();
  await p.getByRole("link", { name: "ID баталгаажуулах" }).first().click();
  await expect(p).toHaveURL(/\/verify/);
  await expect(p.getByText("Иргэний үнэмлэх дээрх бүтэн нэр")).toBeVisible();
  await c.close();
});

test("board: contactless and ID-checked tags and filters", async ({ browser }) => {
  const sol = await profile(NAMES.solongo);
  const cfg = await pricingConfig();
  const now = Date.now();
  const title = `[verify] contactless ${now}`;
  const named = new RegExp(title.replace(/[[\]]/g, "\\$&")); // "[verify]" has brackets
  const t = createErrand(
    { id: crypto.randomUUID(), title, description: "x", category: "deliver", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 3000, customerId: sol.id, details: { contactless: true } },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  const h = await browser.newContext();
  await loginAs(h, PHONES.bat, { mode: "helper" });
  const p = await h.newPage();
  try {
    await p.goto("/jobs?view=all&meet=no&sort=new");
    const card = p.getByRole("link", { name: named });
    await expect(card).toBeVisible();
    await expect(card.getByText("Уулзахгүй")).toBeVisible();
    await p.goto("/jobs?view=all&idok=1&sort=new");
    await expect(p.getByRole("link", { name: named })).toHaveCount(0); // Solongo's ID isn't checked
    await db.from("profiles").update({ kyc_level: 3 }).eq("id", sol.id).throwOnError();
    await p.reload();
    await expect(p.getByRole("link", { name: named }).getByText("ID шалгагдсан")).toBeVisible();
  } finally {
    await db.from("profiles").update({ kyc_level: sol.kyc_level }).eq("id", sol.id).throwOnError();
    await h.close();
  }
});

test("Ops approves a customer ID check as identity only, then sends it back", async ({ browser }) => {
  const sol = await profile(NAMES.solongo);
  const before = { kyc_level: sol.kyc_level, verified_name: sol.verified_name, role: sol.role, helper_status: sol.helper_status };
  const { data: app } = await db
    .from("helper_applications")
    .insert({ user_id: sol.id, purpose: "identity", legal_name: "Solongo Batbayar", id_last4: "4321", birth_date: "1992-03-04", categories: [], consent_at: new Date().toISOString() })
    .select("id")
    .single()
    .throwOnError();
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  try {
    await o.goto(`/ops/helpers/${app!.id}`);
    await expect(o.getByText("Захиалагчийн ID").first()).toBeVisible();
    await o.getByRole("button", { name: "Батлах" }).first().click();
    await o.getByRole("dialog").getByRole("button", { name: "Батлах" }).click();
    await o.waitForURL(/\/ops\/helpers$/);
    let now = await profile(NAMES.solongo);
    expect(now).toMatchObject({ kyc_level: 3, verified_name: "Solongo Batbayar", role: before.role, helper_status: before.helper_status });
    expect((now as unknown as { age_band: number | null }).age_band).toBe(30); // born 1992: the 30–39 band

    await o.goto(`/ops/helpers/${app!.id}`);
    await o.getByRole("button", { name: "Дахин шалгуулах" }).click();
    const sheet = o.getByRole("dialog");
    await sheet.getByRole("textbox").fill("Тест: дахин илгээнэ үү");
    await sheet.getByRole("button", { name: "Дахин шалгуулах" }).click();
    await o.waitForURL(/\/ops\/helpers$/);
    now = await profile(NAMES.solongo);
    expect(now).toMatchObject({ kyc_level: 1, verified_name: null, role: before.role, helper_status: before.helper_status });
  } finally {
    await db.from("helper_applications").delete().eq("id", app!.id);
    await db.from("profiles").update(before).eq("id", sol.id).throwOnError();
    await ops.close();
  }
});

test("a helper adds experience and how they get around", async ({ browser }) => {
  const bat = await profile(NAMES.bat);
  const h = await browser.newContext();
  await loginAs(h, PHONES.bat, { mode: "helper" });
  const p = await h.newPage();
  try {
    await p.goto(`/helpers/${bat.id}`);
    await p.getByRole("button", { name: /Танилцуулга (засах|нэмэх)/ }).click();
    const sheet = p.getByRole("dialog");
    await sheet.getByLabel("Хэдэн жилийн туршлагатай вэ?").fill("5");
    await sheet.getByText("Машин", { exact: true }).click();
    await sheet.getByRole("button", { name: "Хадгалах" }).click();
    await expect(p.getByText("5 жилийн туршлага")).toBeVisible();
    await expect(p.getByText("Машин", { exact: true }).first()).toBeVisible();
  } finally {
    await db.from("profiles").update({ experience_years: null, transport: [] }).eq("id", bat.id).throwOnError();
    await h.close();
  }
});

test("Ops switches off a helper nobody checked", async ({ browser }) => {
  const sol = await profile(NAMES.solongo);
  const before = { role: sol.role, helper_status: sol.helper_status, test_helper: sol.test_helper, kyc_level: sol.kyc_level, categories: sol.categories };
  await db.from("profiles").update({ role: "helper", helper_status: "approved", test_helper: true, categories: ["queue"] }).eq("id", sol.id).throwOnError();
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  try {
    await o.goto("/ops/helpers");
    const row = o.getByRole("listitem").filter({ hasText: NAMES.solongo });
    await expect(row.getByText("Тест товчоор")).toBeVisible();
    await row.getByRole("button", { name: "Туслагч эрхийг хаах" }).click();
    const sheet = o.getByRole("dialog");
    await sheet.getByRole("textbox").fill("Тест бүртгэл");
    await sheet.getByRole("button", { name: "Туслагч эрхийг хаах" }).click();
    await expect(o.getByRole("listitem").filter({ hasText: NAMES.solongo })).toHaveCount(0);
    await expect
      .poll(async () => {
        const p = await profile(NAMES.solongo);
        return { role: p.role, helper_status: p.helper_status, test_helper: p.test_helper };
      })
      .toEqual({ role: "customer", helper_status: null, test_helper: false });
  } finally {
    await db.from("profiles").update(before).eq("id", sol.id).throwOnError();
    await ops.close();
  }
});
