import { expect, test } from "@playwright/test";
import { ibanFor } from "@/lib/kyc-rules";
import { NAMES, PHONES, db, loginAs, profile, watchErrors } from "./support";

/**
 * No bank account, no work (docs/decisions.md 2026-11-18 "Bank account before working"): a helper
 * without one sees only "add your bank account" in worker mode, can't go online or apply, and the
 * database leaves them out of the nearby feed. Adding it (in their own ID-checked name) opens work.
 */
test("a helper without a bank account adds one before working", async ({ browser }) => {
  const nomin = await profile(NAMES.nomin);
  const { data: saved } = await db.from("payout_accounts").select("*").eq("user_id", nomin.id).maybeSingle();
  await db.from("payout_accounts").delete().eq("user_id", nomin.id);
  // the holder name must be typed in Cyrillic and match the checked ID (2026-11-26)
  const idName = "Ариунболдын Номин";
  await db.from("profiles").update({ verified_name: idName }).eq("id", nomin.id).throwOnError();
  try {
    // the database: no account → nothing in the nearby feed
    const { data: feed, error } = await db.rpc("nearby_open_deals", { p_helper_id: nomin.id });
    expect(error).toBeNull();
    expect(feed).toEqual([]);

    const ctx = await browser.newContext();
    await loginAs(ctx, PHONES.nomin, { mode: "helper" });
    const h = await ctx.newPage();
    const errors = watchErrors(h);
    await h.goto("/jobs");
    await expect(h.getByRole("heading", { name: "Ажиллаж эхлэхийн тулд банкны дансаа нэмнэ үү" })).toBeVisible();

    await h.getByRole("link", { name: "Банкны данс нэмэх" }).click();
    await h.waitForURL(/\/helper\/bank/);
    await h.getByRole("combobox").selectOption("Хаан банк");
    // the ordinary number people know; the app builds the IBAN and shows it back (2026-11-26)
    await h.getByLabel("Дансны дугаар эсвэл IBAN").fill("5000 1234 56");
    await expect(h.getByText(/Таны IBAN: MN\d{2} 0005 0050 0012 3456/)).toBeVisible();
    // someone else's name is refused
    await h.getByLabel("Данс эзэмшигч").fill("Болдын Бат");
    await h.getByRole("button", { name: "Хадгалах" }).click();
    await expect(h.getByRole("alert").filter({ hasText: "өөрийн нэр дээр" })).toBeVisible();
    await h.getByLabel("Данс эзэмшигч").fill(idName);
    await h.getByRole("button", { name: "Хадгалах" }).click();
    await h.waitForURL(/\/jobs$/);
    await expect(h.getByRole("heading", { name: "Ажиллаж эхлэхийн тулд банкны дансаа нэмнэ үү" })).toHaveCount(0);

    const { data: row } = await db.from("payout_accounts").select("bank, account_number, holder_name, verified_at").eq("user_id", nomin.id).single();
    expect(row).toMatchObject({ bank: "Хаан банк", account_number: ibanFor("0005", "5000123456"), holder_name: idName });
    // a matching name no longer proves ownership (2026-11-22): it waits for Ops' bank check
    expect(row!.verified_at).toBeNull();

    // the profile shows only the last 4 digits
    await h.goto("/helper/bank");
    await expect(h.getByText("•••• 3456")).toBeVisible();
    await expect(h.getByText(ibanFor("0005", "5000123456"))).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  } finally {
    // put the demo account back (as an IBAN: older numbers can't be saved any more)
    if (saved) await db.from("payout_accounts").upsert({ ...saved, account_number: /^MN\d{18}$/.test(saved.account_number) ? saved.account_number : ibanFor("0005", saved.account_number) });
    await db.from("profiles").update({ verified_name: nomin.verified_name }).eq("id", nomin.id);
  }
});
