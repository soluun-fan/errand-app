import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { insertDeal, runCommand } from "@/lib/db/deals";
import { actorFromProfile } from "@/lib/db/mapping";
import { amountDue, createErrand } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing";
import { NAMES, PHONES, cancelIfOpen, db, errand, ledgerClean, loginAs, profile } from "./support";

/**
 * Fee-only payments (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"): the app takes only our fee;
 * the customer pays the helper directly and both mark it; "not paid" blocks posting until Ops settles
 * it; wire.mn's webhook counts only when signed. Run with WIRE_WEBHOOK_SECRET set (any test value).
 */
test.describe.configure({ mode: "serial" });
const SECRET = process.env.WIRE_WEBHOOK_SECRET ?? "";
const created: string[] = [];
let batId = "";
let hadAccount = false;
/** Bat's account number, as the customer should see it once the job is done. */
let batAccount = "MN500005005012345678";

test.beforeAll(async () => {
  const bat = await profile(NAMES.bat);
  batId = bat.id;
  hadAccount = Boolean((await db.from("payout_accounts").select("user_id").eq("user_id", batId).maybeSingle()).data);
  if (!hadAccount) await db.from("payout_accounts").insert({ user_id: batId, bank: "Khan Bank", account_number: batAccount, holder_name: "Bat-Erdene G." }).throwOnError();
  batAccount = (await db.from("payout_accounts").select("account_number").eq("user_id", batId).single<{ account_number: string }>()).data!.account_number;
});
test.afterAll(async () => {
  await cancelIfOpen(created);
  const { data: admin } = await db.from("profiles").select("id").eq("role", "admin").limit(1).single();
  await db.from("direct_payments").update({ resolved_at: new Date().toISOString(), resolved_by: admin?.id, note: "[verify] e2e" }).in("deal_id", created).is("resolved_at", null).not("unpaid_reported_at", "is", null);
  // test payments through the fake webhook: no real money moved, so their records go
  await db.from("provider_refunds").delete().in("deal_id", created);
  await db.from("provider_payments").delete().in("deal_id", created);
  if (!hadAccount) await db.from("payout_accounts").delete().eq("user_id", batId);
  expect(await ledgerClean()).toEqual([]);
});

async function task(title: string) {
  const sol = await profile(NAMES.solongo);
  // new tasks are managed-service now (docs/decisions.md 2026-11-18); fee-only tasks still running must keep working
  const cfg = { ...(await pricingConfig()), payMode: "direct" as const };
  const now = Date.now();
  const t = createErrand(
    { id: crypto.randomUUID(), title, description: "x", category: "queue", mode: "now", address: "Test", itemBudget: 0, fee: cfg.minFee + 2000, customerId: sol.id },
    { now, actor: actorFromProfile(sol, now) },
    cfg,
  );
  await insertDeal(db, t);
  created.push(t.deal.id);
  const bat = await profile(NAMES.bat);
  await runCommand(db, t.deal.id, { type: "apply", note: "" }, actorFromProfile(bat, Date.now()));
  await runCommand(db, t.deal.id, { type: "choose", helperId: bat.id }, actorFromProfile(sol, Date.now()));
  return { id: t.deal.id, sol, bat };
}

async function finishJob(id: string) {
  const [sol, bat] = await Promise.all([profile(NAMES.solongo), profile(NAMES.bat)]);
  const b = actorFromProfile(bat, Date.now());
  await runCommand(db, id, { type: "start" }, b);
  await runCommand(db, id, { type: "record_handover" }, b);
  await db.from("proofs").insert({ deal_id: id, kind: "handover", uploaded_by: bat.id, note: "check-out" });
  await runCommand(db, id, { type: "finish" }, b);
  await runCommand(db, id, { type: "confirm" }, actorFromProfile(sol, Date.now()));
}

test("the customer pays only our fee, then pays the helper directly; both mark it", async ({ browser }) => {
  const { id } = await task("[verify] direct pay");
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/tasks/${id}`);
  const d0 = await errand(id);
  await expect(c.getByText(/үйлчилгээний хураамжийг төлж баталгаажуулна уу/)).toBeVisible();
  // simulated payment (no wire.mn key in tests): only the fee
  // today's many test payments would hit the customer's daily safety cap: lift it for this payment only
  const { data: ctl } = await db.from("platform_controls").select("max_customer_daily").single();
  await db.from("platform_controls").update({ max_customer_daily: 100_000_000 }).eq("id", true);
  // the pay sheet opens by itself on arrival; it asks for the fee only
  const sheet = c.locator("dialog[open]");
  await expect(sheet.getByText(`${d0.serviceFee.toLocaleString("en-US")}₮ төлөх`)).toBeVisible();
  await sheet.getByRole("button", { name: "Khan Bank" }).click();
  try {
    await expect.poll(async () => (await errand(id)).status, { timeout: 30_000 }).toBe("matched");
  } finally {
    await db.from("platform_controls").update({ max_customer_daily: ctl?.max_customer_daily }).eq("id", true);
  }
  expect((await errand(id)).heldAmount).toBe(d0.serviceFee);

  await finishJob(id);
  await c.goto(`/tasks/${id}`);
  await expect(c.getByText(batAccount)).toBeVisible(); // the helper's account, to pay directly
  await c.getByRole("button", { name: "Би төлсөн" }).click();
  await expect.poll(async () => (await db.from("direct_payments").select("customer_paid_at").eq("deal_id", id).maybeSingle()).data?.customer_paid_at).toBeTruthy();

  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await expect(h.getByText("Захиалагч танд төлсөн гэж байна.")).toBeVisible();
  await h.getByRole("button", { name: "Хүлээн авсан", exact: true }).click();
  await expect.poll(async () => (await db.from("direct_payments").select("helper_received_at").eq("deal_id", id).single()).data?.helper_received_at).toBeTruthy();
  // the app paid nobody: only our fee moved
  const { data: rows } = await db.from("ledger_entries").select("kind, to_account").eq("deal_id", id);
  expect(rows?.filter((r) => r.to_account.startsWith("payable:"))).toEqual([]);
  await Promise.all([customer.close(), helper.close()]);
});

test("'not paid' blocks the customer from posting until Ops settles it", async ({ browser }) => {
  const { id } = await task("[verify] not paid");
  await runCommand(db, id, { type: "confirm_payment", providerRef: `e2e-${id}`, amount: amountDue(await errand(id)) }, { kind: "provider" });
  await finishJob(id);
  const helper = await browser.newContext();
  await loginAs(helper, PHONES.bat);
  const h = await helper.newPage();
  await h.goto(`/jobs/${id}`);
  await h.getByRole("button", { name: "Төлбөр аваагүй", exact: true }).click();
  await h.locator("dialog[open]").getByRole("button", { name: "Төлбөр аваагүй", exact: true }).click();
  await expect.poll(async () => (await db.from("direct_payments").select("unpaid_reported_at").eq("deal_id", id).single()).data?.unpaid_reported_at).toBeTruthy();

  // the customer can't post now
  const customer = await browser.newContext();
  await loginAs(customer, PHONES.solongo);
  const c = await customer.newPage();
  await c.goto(`/post?cat=queue&title=${encodeURIComponent("[verify] blocked")}`);
  await c.evaluate(() => localStorage.clear());
  await c.locator("textarea").first().fill("x");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("textbox", { name: "Хаана?", exact: true }).fill("Test");
  await c.getByRole("button", { name: "Үргэлжлүүлэх" }).click();
  await c.getByRole("button", { name: /^Даалгавар нийтлэх/ }).click();
  await expect(c.getByText(/туслагч төлбөр аваагүй гэж мэдэгдсэн/)).toBeVisible();

  // Ops settles it on /ops/payments
  const ops = await browser.newContext();
  await loginAs(ops, PHONES.ops);
  const o = await ops.newPage();
  await o.goto("/ops/payments");
  await o.getByRole("button", { name: "Шийдсэн гэж тэмдэглэх" }).first().click();
  await o.locator("dialog[open] textarea").fill("[verify] paid in cash");
  await o.locator("dialog[open]").getByRole("button", { name: "Шийдсэн гэж тэмдэглэх" }).click();
  await expect.poll(async () => (await db.from("direct_payments").select("resolved_at").eq("deal_id", id).single()).data?.resolved_at).toBeTruthy();
  await Promise.all([helper.close(), customer.close(), ops.close()]);
});

test("wire.mn's webhook: only signed messages count, a repeat is ignored, a late payment is refunded", async ({ request }) => {
  test.skip(!SECRET, "set WIRE_WEBHOOK_SECRET to run this test");
  const { id } = await task("[verify] wire webhook");
  const d = await errand(id);
  const pi = `pi_e2e_${crypto.randomUUID().slice(0, 8)}`;
  await db.from("provider_payments").insert({ id: pi, provider: "wire", deal_id: id, purpose: `fee-${d.assignedAt}`, amount: d.serviceFee }).throwOnError();
  const event = (evt: string, intent: string, amount: number) => JSON.stringify({ id: evt, object: "event", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000), data: { id: intent, object: "payment_intent", status: "succeeded", amount, currency: "MNT", charge: `ch_${intent}` } });
  const post = (body: string, secret = SECRET) => {
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    return request.post("/api/payments/wire", { data: body, headers: { "content-type": "application/json", "WirePayment-Signature": `t=${t},v1=${sig}` } });
  };
  const body = event(`evt_${pi}`, pi, d.serviceFee);
  expect((await post(body, "whsec_wrong")).status()).toBe(400); // a forged message changes nothing
  expect((await errand(id)).status).toBe("awaiting_payment");
  expect((await post(body)).status()).toBe(200);
  await expect.poll(async () => (await errand(id)).status).toBe("matched");
  const again = await post(body);
  expect(await again.json()).toMatchObject({ duplicate: true });
  expect((await errand(id)).heldAmount).toBe(d.serviceFee);

  // a second payment for a task that is already paid: refunded, never booked twice
  const late = `pi_e2e_${crypto.randomUUID().slice(0, 8)}`;
  await db.from("provider_payments").insert({ id: late, provider: "wire", deal_id: id, purpose: "fee-late", amount: d.serviceFee }).throwOnError();
  expect((await post(event(`evt_${late}`, late, d.serviceFee))).status()).toBe(200);
  await expect.poll(async () => (await db.from("provider_payments").select("status").eq("id", late).single()).data?.status).toBe("refunded_late");
  const { data: refund } = await db.from("provider_refunds").select("amount, reason").eq("payment_id", late).single();
  expect(refund).toMatchObject({ amount: d.serviceFee, reason: expect.stringContaining("late payment") });
  expect((await errand(id)).heldAmount).toBe(d.serviceFee);
});
