import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, loginAs, profile } from "./support";

/**
 * Talk before choosing (docs/decisions.md 2026-11-17): while a task is open, the customer and each
 * applicant have their own chat (and call). Others can't read it; phone numbers stay masked.
 */
const created: string[] = [];
test.afterAll(async () => {
  await cancelIfOpen(created);
});

test("the customer chats with an applicant before choosing; nobody else can read it", async ({ browser }) => {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const cfg = await pricingConfig();
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title: "[verify] talk first", description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 1000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  const id = t.deal.id;
  created.push(id);
  await runCommand(db, id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));

  // customer: the applicant's card has its own chat + call
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  await expect(c.locator(`a[href="/chat/${id}?with=${bat.id}"]`).first()).toBeVisible();
  await c.goto(`/chat/${id}?with=${bat.id}`);
  const box = c.locator("textarea, input[type=text]").last();
  await box.fill("Сайн байна уу, маргааш 9 цагт амжих уу? 99112233");
  // the send button of the box we typed in (the report-a-problem sheet has its own)
  await box.locator("xpath=ancestor::form[1]").getByRole("button", { name: "Илгээх", exact: true }).click();
  await expect.poll(async () => (await db.from("messages").select("text").eq("deal_id", id).eq("helper_id", bat.id)).data?.map((m) => m.text)).toEqual([
    expect.stringContaining("•••• ••••"), // the phone number was masked
  ]);

  // the applicant sees the chat row on the job page and the message in their conversation
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByRole("link", { name: /Чат/ }).first()).toBeVisible();
  await h.goto(`/chat/${id}`);
  await expect(h.getByText("маргааш 9 цагт")).toBeVisible();

  // asking to be paid outside the app: flagged, the sender is reminded, the reader is warned (2026-11-25)
  const hbox = h.locator("textarea, input[type=text]").last();
  await hbox.fill("Тэгвэл дансаар шилжүүлчих, хямд болно");
  await hbox.locator("xpath=ancestor::form[1]").getByRole("button", { name: "Илгээх", exact: true }).click();
  await expect(h.getByText(/Сануулга: төлбөрөө зөвхөн/)).toBeVisible();
  await expect
    .poll(async () => (await db.from("messages").select("flags").eq("deal_id", id).eq("from_user_id", bat.id)).data?.flatMap((m) => m.flags))
    .toContain("pay_outside");
  await c.reload();
  await expect(c.getByText(/Аппаас гадуур хэзээ ч бүү төлөөрэй/)).toBeVisible();

  // another helper (not an applicant) can't read it: they only get their own, separate thread
  // for a question before applying (pre-application chat), which starts empty
  const other = await browser.newContext();
  await loginAs(other, PHONES.nomin);
  const o = await other.newPage();
  await o.goto(`/chat/${id}`);
  await expect(o.getByText("Санал өгөхөөс өмнөх хувийн яриа")).toBeVisible();
  await expect(o.getByText("маргааш 9 цагт")).toHaveCount(0);
  await Promise.all([customer.close(), helper.close(), other.close()]);
});
