import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { BANK_CODES, ibanFor, normalizeAccount } from "@/lib/kyc-rules";
import { createTestDb } from "./pg";

/** Migration 20261126060000: the database turns an old account number into the same IBAN the app builds. */
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

const iban = async (bank: string, account: string) => (await db.query<{ v: string | null }>("select public.mn_iban($1, $2) as v", [bank, account])).rows[0].v;

it("matches the app's IBAN for every bank with a known code", async () => {
  for (const [bank, code] of Object.entries(BANK_CODES)) {
    const v = await iban(bank, "5000123456");
    expect(v).toBe(ibanFor(code!, "5000123456"));
    expect(normalizeAccount(v!)).toBe(v); // valid check digits
  }
});

it("leaves an IBAN as it is, and gives up on unknown banks or odd numbers", async () => {
  expect(await iban("Хаан банк", "MN350005001109042377")).toBe("MN350005001109042377");
  expect(await iban("Чингис хаан банк", "5000123456")).toBeNull();
  expect(await iban("Хаан банк", "12")).toBeNull();
});

/** Migration 20261127020000: the IBAN rule checks numbers when entered, not every later update. */
it("lets an old account be marked or unmarked as checked, but never saves a new non-IBAN number", async () => {
  const user = "00000000-0000-4000-8000-00000000ab01";
  await db.query("insert into auth.users (id, phone) values ($1, '99130001')", [user]);
  await db.query("alter table public.payout_accounts disable trigger payout_accounts_iban");
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Голомт банк', '1234567890123', 'Бат')", [user]);
  await db.query("alter table public.payout_accounts enable trigger payout_accounts_iban");
  await db.query("update public.payout_accounts set verified_at = now() where user_id = $1", [user]);
  await db.query("update public.payout_accounts set verified_at = null where user_id = $1", [user]);
  await expect(db.query("update public.payout_accounts set account_number = '1234567890' where user_id = $1", [user])).rejects.toThrow(/IBAN/);
  await expect(
    db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5000123456', 'Бат') on conflict (user_id) do update set account_number = excluded.account_number", [user]),
  ).rejects.toThrow(/IBAN/);
  await db.query("update public.payout_accounts set account_number = $2 where user_id = $1", [user, ibanFor(BANK_CODES["Хаан банк"]!, "5000123456")]);
});
