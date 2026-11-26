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
