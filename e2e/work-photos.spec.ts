import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, db, errand, ledgerClean, loginAs, profile, watchErrors } from "./support";

/**
 * Work photos (docs/decisions.md 2026-11-18 "Work photos"): a photo with the review goes public;
 * the helper asks to show a job photo, the customer allows it; it shows on the helper's profile and
 * Home; anyone can report it. Everything the test made public is taken down again at the end.
 */
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=",
  "base64",
);
const UPLOAD = { timeout: 60_000 };
let dealId = "";
let ratingBefore: { rating_sum: number; rating_count: number } | null = null;

test.afterAll(async () => {
  if (!dealId) return;
  // take down everything this test made public, and undo the test rating on Bat's profile
  const { data: rows } = await db.from("work_photos").select("id, file_path, proof_id, staging_path").eq("deal_id", dealId);
  const files = (rows ?? []).map((r) => r.file_path).filter(Boolean) as string[];
  if (files.length) await db.storage.from("work-photos").remove(files);
  const staged = (rows ?? []).map((r) => r.staging_path).filter(Boolean) as string[];
  if (staged.length) await db.storage.from("task-photos").remove(staged);
  await db.from("work_photos").delete().eq("deal_id", dealId);
  const { data: proofs } = await db.from("proofs").select("file_path").eq("deal_id", dealId);
  const pf = (proofs ?? []).map((p) => p.file_path).filter(Boolean) as string[];
  if (pf.length) await db.storage.from("proofs").remove(pf);
  const bat = await profile(NAMES.bat);
  const { data: rating } = await db.from("ratings").select("stars").eq("deal_id", dealId).maybeSingle<{ stars: number }>();
  if (rating && ratingBefore) {
    await db.from("ratings").delete().eq("deal_id", dealId);
    await db.from("profiles").update(ratingBefore).eq("id", bat.id);
  }
  expect(await ledgerClean()).toEqual([]);
});

test("review photo, portfolio request, customer allows, profile + Home show it, report works", async ({ browser }) => {
  const [sol, bat, nomin] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat), profile(NAMES.nomin)]);
  const { data: stats } = await db.from("profiles").select("rating_sum, rating_count").eq("id", bat.id).single<{ rating_sum: number; rating_count: number }>();
  ratingBefore = { rating_sum: Number(stats!.rating_sum), rating_count: Number(stats!.rating_count) };
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] work photos", description: "x", category: "repair", mode: "now", address: "Test", itemBudget: 0, fee: 20_000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  dealId = t.deal.id;
  const batActor = actorFromProfile(bat, Date.now());
  const solActor = actorFromProfile(sol, Date.now());
  await runCommand(db, dealId, { type: "apply", note: "" }, batActor);
  await runCommand(db, dealId, { type: "choose", helperId: bat.id }, solActor);
  await runCommand(db, dealId, { type: "confirm_payment", providerRef: `e2e-${dealId}`, amount: amountDue(await errand(dealId)) }, { kind: "provider" });
  await runCommand(db, dealId, { type: "start" }, batActor);
  // the helper's handover photo (a real JPEG in the private proofs bucket)
  const proofPath = `${dealId}/handover-${crypto.randomUUID()}.jpg`;
  expect((await db.storage.from("proofs").upload(proofPath, JPEG, { contentType: "image/jpeg" })).error).toBeNull();
  await db.from("proofs").insert({ deal_id: dealId, kind: "handover", mime: "image/jpeg", file_path: proofPath, bytes: JPEG.length, uploaded_by: bat.id }).throwOnError();
  await runCommand(db, dealId, { type: "record_handover" }, batActor);
  await runCommand(db, dealId, { type: "finish" }, batActor);
  await runCommand(db, dealId, { type: "confirm" }, solActor);
  expect((await errand(dealId)).status).toBe("released");

  // 1. the customer rates with a photo
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  const cErrors = watchErrors(c);
  await c.goto(`/tasks/${dealId}`);
  await c.getByRole("button", { name: `${NAMES.bat}-г үнэлэх` }).click();
  const sheet = c.getByRole("dialog");
  await sheet.locator("textarea[name=note]").fill("Тавиурыг маш сайн засаж өгсөн, баярлалаа!");
  await sheet.locator("input[type=file]").setInputFiles({ name: "review.png", mimeType: "image/png", buffer: PNG });
  await expect(sheet.getByRole("img", { name: "Ажлын зураг 1" })).toBeVisible(UPLOAD);
  await sheet.getByRole("button", { name: "Үнэлгээ илгээх" }).click();
  await expect
    .poll(async () => (await db.from("work_photos").select("source, status, in_portfolio").eq("deal_id", dealId)).data, UPLOAD)
    .toEqual([{ source: "review", status: "shown", in_portfolio: true }]);
  const { data: rev } = await db.from("work_photos").select("file_path").eq("deal_id", dealId).eq("source", "review").single<{ file_path: string }>();
  const reviewUrl = db.storage.from("work-photos").getPublicUrl(rev!.file_path).data.publicUrl;
  expect((await fetch(reviewUrl)).status).toBe(200); // really public

  // 2. the helper asks to show their handover photo
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${dealId}`);
  await h.getByRole("button", { name: "Зураг сонгох" }).click();
  const ask = h.getByRole("dialog");
  await ask.locator("input[name=proofId]").first().check();
  await ask.getByRole("button", { name: "Захиалагчаас асуух" }).click();
  await expect.poll(async () => (await db.from("work_photos").select("status").eq("deal_id", dealId).eq("source", "helper")).data, UPLOAD).toEqual([{ status: "asked" }]);
  await h.reload();
  await expect(h.getByText("Захиалагчийн хариуг хүлээж байна")).toBeVisible();

  // 3. the customer allows it
  await c.goto(`/tasks/${dealId}`);
  await expect(c.getByText(`${NAMES.bat} эдгээр зургийг харуулахыг хүсэж байна`)).toBeVisible();
  await c.getByRole("button", { name: "Зөвшөөрөх" }).click();
  await expect.poll(async () => (await db.from("work_photos").select("status").eq("deal_id", dealId).eq("source", "helper")).data, UPLOAD).toEqual([{ status: "shown" }]);
  expect(cErrors).toEqual([]);

  // 4. another person sees both on Bat's profile and on Home, and reports one
  const other = await browser.newContext();
  await loginAs(other, PHONES.nomin);
  const o = await other.newPage();
  await o.goto(`/helpers/${bat.id}`);
  await expect(o.getByRole("heading", { name: /Ажлын зураг · \d+/ })).toBeVisible();
  await expect(o.getByRole("img", { name: /Хийсэн ажил: Жижиг засвар|Хийсэн ажил:/ }).first()).toBeVisible();
  await o.getByRole("button", { name: "Мэдэгдэх" }).first().click();
  const rep = o.getByRole("dialog");
  await rep.getByLabel("Ажлын зураг биш").check();
  await rep.getByRole("button", { name: "Мэдэгдэх" }).click();
  await expect.poll(async () => (await db.from("work_photo_reports").select("reporter_id").eq("reporter_id", nomin.id)).data?.length ?? 0, UPLOAD).toBeGreaterThan(0);
  // finished work shows on the website's home (phones keep Home short since 2026-11-24)
  await o.setViewportSize({ width: 1280, height: 900 });
  await o.goto("/");
  await expect(o.getByRole("heading", { name: "Туслагчдын хийсэн ажил" })).toBeVisible();
  await o.setViewportSize({ width: 390, height: 844 });

  // 5. the customer takes the review photo down: gone from the public bucket
  await c.reload();
  await c.getByRole("button", { name: "Устгах" }).first().click();
  await c.getByRole("dialog").getByRole("button", { name: "Устгах" }).click();
  await expect.poll(async () => (await db.from("work_photos").select("status").eq("deal_id", dealId).eq("status", "removed")).data?.length ?? 0, UPLOAD).toBe(1);
  await expect.poll(async () => (await fetch(`${reviewUrl}?x=${Date.now()}`)).status, UPLOAD).not.toBe(200);
  await Promise.all([customer.close(), helper.close(), other.close()]);
});
