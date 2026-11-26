import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * More photos (docs/decisions.md 2026-11-17 "more photos"): the customer adds photos when posting;
 * the helper must take a start photo to start, and can send progress photos with a note.
 */
test.describe.configure({ mode: "serial" });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const created: string[] = [];
/** uploads go straight to Supabase Storage; on a slow line one can take 10+ s */
const UPLOAD = { timeout: 60_000 };

test.afterAll(async () => {
  await cancelIfOpen(created);
  expect(await ledgerClean()).toEqual([]);
});

test("photos added while posting reach the task; only people who may see the task see them", async ({ browser }) => {
  const bat = await profile(NAMES.bat);
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  // a direct request to Bat: nobody else is notified
  await c.goto(`/post?helper=${bat.id}&cat=queue&title=${encodeURIComponent("[verify] Зурагтай даалгавар")}`);
  await c.evaluate(() => localStorage.clear());
  await c.locator("textarea").first().fill("Дарааллын хуудас зурагт байна");
  await c.locator("input[type=file]").setInputFiles({ name: "queue.png", mimeType: "image/png", buffer: PNG });
  await expect(c.getByRole("img", { name: "Ажлын зураг 1" })).toBeVisible(UPLOAD);
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("textbox", { name: "Хаана?", exact: true }).fill("Татварын газар, 1-р хороо");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("button", { name: /^Даалгавар нийтлэх/ }).click();
  await c.waitForURL(/\/tasks\//, UPLOAD);
  const id = c.url().split("/tasks/")[1].split(/[?#]/)[0];
  created.push(id);

  const { data: rows } = await db.from("task_photos").select("file_path").eq("deal_id", id);
  expect(rows).toHaveLength(1);
  expect(rows![0].file_path).toMatch(new RegExp(`^u/[0-9a-f-]{36}/[0-9a-f-]{36}\\.jpg$`));
  await expect(c.getByRole("img", { name: "Ажлын зураг 1" })).toBeVisible(); // the customer's task page

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByRole("img", { name: "Ажлын зураг 1" })).toBeVisible(); // the invited helper

  const other = await browser.newContext();
  await loginAs(other, PHONES.nomin);
  const o = await other.newPage();
  await o.goto(`/jobs/${id}`);
  await expect(o.getByText("Энэ хуудас олдсонгүй")).toBeVisible();
  await expect(o.getByRole("img", { name: "Ажлын зураг 1" })).toHaveCount(0);
  await Promise.all([customer.close(), helper.close(), other.close()]);
});

test("the helper starts with a photo, sends a progress photo (phone hidden), the customer sees both", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] start photo", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  const batActor = actorFromProfile(bat, Date.now());
  const solActor = actorFromProfile(sol, Date.now());
  await runCommand(db, id, { type: "apply", note: "" }, batActor);
  await runCommand(db, id, { type: "choose", helperId: bat.id }, solActor);
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  expect((await errand(id)).status).toBe("matched");

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByRole("button", { name: "Ажлыг эхлүүлэх", exact: true })).toHaveCount(0); // no start without the photo
  await h.locator("input[type=file]").setInputFiles({ name: "start.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await errand(id)).status, UPLOAD).toBe("in_progress");

  await h.reload();
  await h.getByPlaceholder("Ж: Бараагаа авлаа, явж байна").fill("Дараалалд орлоо 99112233");
  // the progress slot is the first file input while in progress (no receipt on this task)
  await h.locator("input[type=file]").first().setInputFiles({ name: "progress.png", mimeType: "image/png", buffer: PNG });
  await expect.poll(async () => (await db.from("proofs").select("kind, note").eq("deal_id", id).order("created_at")).data, UPLOAD).toEqual([
    { kind: "start", note: null },
    { kind: "progress", note: expect.stringContaining("•••• ••••") },
  ]);

  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(/Эхлэл/).first()).toBeVisible();
  await expect(c.getByText(/Дараалалд орлоо/).first()).toBeVisible();
  await expect(c.getByText("99112233")).toHaveCount(0);

  // finish the job so nothing stays held
  await runCommand(db, id, { type: "record_handover" }, batActor);
  await runCommand(db, id, { type: "finish" }, batActor);
  await runCommand(db, id, { type: "confirm" }, solActor);
  expect((await errand(id)).status).toBe("released");
  await Promise.all([helper.close(), customer.close()]);
});
