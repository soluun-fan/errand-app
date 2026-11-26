import { expect, test } from "@playwright/test";
import { PHONES, db, loginAs } from "./support";

/** Ops changes suggestions and search words with no deploy (docs/decisions.md 2026-11-16 "From the database"). */
const TITLE = "Цорго засах";
const WORD = "хаалга";
let before: { id: string; active: boolean };
let repairWords: string[] = [];
const wordsNow = async () => ((await db.from("category_keywords").select("word").eq("category", "repair")).data ?? []).map((r) => r.word as string).sort();

test.beforeAll(async () => {
  const { data } = await db.from("quick_starts").select("id, active").eq("title_mn", TITLE).single();
  before = data!;
  // a run cut off by a network drop may have left the test word behind: start clean
  await db.from("category_keywords").delete().eq("category", "repair").eq("word", WORD);
  repairWords = await wordsNow();
});
test.afterAll(async () => {
  await db.from("quick_starts").update({ active: before.active }).eq("id", before.id);
  // put the repair words back exactly as they were
  const now = await wordsNow();
  const extra = now.filter((w) => !repairWords.includes(w));
  const missing = repairWords.filter((w) => !now.includes(w));
  if (extra.length) await db.from("category_keywords").delete().eq("category", "repair").in("word", extra);
  if (missing.length) await db.from("category_keywords").insert(missing.map((word) => ({ category: "repair", word })));
  expect(await wordsNow()).toEqual(repairWords);
});

test("hiding a quick start takes it off Home at once, and it's logged", async ({ browser }) => {
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/content");
  const row = o.locator("details", { has: o.locator("summary", { hasText: TITLE }) });
  await row.locator("summary").click();
  await row.locator("input[name=active]").uncheck();
  await row.getByRole("button", { name: "Хадгалах" }).click();
  await expect.poll(async () => (await db.from("quick_starts").select("active").eq("id", before.id).single()).data?.active).toBe(false);
  const { data: log } = await db.from("ops_audit_log").select("action").eq("target", before.id).order("created_at", { ascending: false }).limit(1);
  expect(log?.[0]?.action).toBe("quick_start.update");

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.setViewportSize({ width: 1280, height: 900 });
  await c.goto("/");
  await expect(c.getByText("Буйдан зөөх").first()).toBeVisible();
  await expect(c.getByText(TITLE)).toHaveCount(0);
  await Promise.all([ops.close(), customer.close()]);
});

test("a new search word guesses the kind of task right away", async ({ browser }) => {
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/content");
  const form = o.locator("form", { has: o.locator("input[name=category][value=repair]") });
  const words = form.locator("textarea");
  await expect(words).toHaveValue(new RegExp(repairWords[0])); // hydrated with the stored list
  await words.fill([...repairWords, WORD].join("\n"));
  await form.getByRole("button", { name: "Хадгалах" }).click();
  // exactly the old list plus the new word — nothing merged, nothing lost
  await expect.poll(wordsNow).toEqual([...repairWords, WORD].sort());

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/post?title=${encodeURIComponent("Хаалга солих")}`);
  await expect(c.getByText("2 / 4")).toBeVisible(); // skipped "what kind?" — guessed repair
  await Promise.all([ops.close(), customer.close()]);
});

test("customers can't open the Ops page", async ({ page, context }) => {
  await loginAs(context, PHONES.solongo);
  await page.goto("/ops/content");
  await expect(page.getByText("Энэ хуудас олдсонгүй")).toBeVisible();
  await expect(page.getByText("Хайлтын үгс")).toHaveCount(0);
});
