import { describe, expect, it } from "vitest";
import { accountToIban, cleanCyrillicName, cleanLegalName, ibanFor, isAdult, KYC_DOCS, maskAccount, normalizeAccount, payoutNameOk } from "@/lib/kyc-rules";

const NOW = new Date("2026-11-15T03:00:00Z");

describe("KYC rules", () => {
  it("requests only identity documents, never a criminal-record certificate", () => {
    expect(KYC_DOCS).toEqual(["id_front", "id_back", "selfie"]);
  });

  it("18+ only, with a sane date", () => {
    expect(isAdult("2008-11-15", NOW)).toBe(true); // 18 today
    expect(isAdult("2008-11-16", NOW)).toBe(false); // 18 tomorrow
    expect(isAdult("1990-01-01", NOW)).toBe(true);
    expect(isAdult("2030-01-01", NOW)).toBe(false);
    expect(isAdult("1900-01-01", NOW)).toBe(false);
    expect(isAdult("15/11/1990", NOW)).toBe(false);
  });

  it("accepts Mongolian IBANs and plain account numbers, nothing else", () => {
    // Published MOD97 example in the Bank of Mongolia's IBAN specification.
    expect(normalizeAccount("mn35 0005 0011 0904 2377")).toBe("MN350005001109042377");
    expect(normalizeAccount("MN360005001109042377")).toBeNull(); // wrong check digits
    expect(normalizeAccount("MN350005001109042378")).toBeNull(); // mistyped account
    expect(normalizeAccount("MN12 0005 0050 0512 3456 78")).toBeNull(); // too long
    expect(normalizeAccount(ibanFor("0005", "5000002290"))).toBe(ibanFor("0005", "5000002290")); // a built IBAN passes its own check
    expect(normalizeAccount("5005-123-456")).toBeNull(); // old domestic numbers: IBAN only since 2026-11-26
    expect(normalizeAccount("MN35 0005 0011 0904 237A")).toBeNull(); // only "MN" may be letters
    expect(normalizeAccount("abc")).toBeNull();
    expect(normalizeAccount("12345")).toBeNull();
    expect(maskAccount("5005123456")).toBe("•••• 3456");
  });

  it("payout holder must be the same person as on the ID (case/space/dot-insensitive)", () => {
    expect(payoutNameOk("Бат-Эрдэнэ Г.", "бат-эрдэнэ г")).toBe(true);
    expect(payoutNameOk("Бат-Эрдэнэ Г.", "Болд Д.")).toBe(false);
  });

  it("legal names: letters, spaces, dots, hyphens", () => {
    expect(cleanLegalName("  Гантулга   Бат-Эрдэнэ ")).toBe("Гантулга Бат-Эрдэнэ");
    expect(cleanLegalName("<b>x</b>")).toBeNull();
    expect(cleanLegalName("Ab")).toBeNull();
  });

  it("an ordinary account number becomes an IBAN with the chosen bank's code; a pasted IBAN must be that bank's (2026-11-26)", () => {
    expect(accountToIban("5000 1234 56", "Хаан банк")).toEqual({ iban: ibanFor("0005", "5000123456"), built: true });
    expect(accountToIban("5000123456", "Хаан банк")).toMatchObject({ iban: expect.stringMatching(/^MN\d{2}0005005000123456$/) });
    expect(accountToIban("mn35 0005 0011 0904 2377", "Хаан банк")).toEqual({ iban: "MN350005001109042377", built: false });
    expect(accountToIban("MN350005001109042377", "Голомт банк")).toEqual({ error: "bank" }); // a Khan Bank IBAN, Golomt chosen
    expect(accountToIban("MN360005001109042377", "Хаан банк")).toEqual({ error: "format" }); // bad check digits
    expect(accountToIban("5000123456", "Чингис хаан банк")).toEqual({ error: "format" }); // code not confirmed yet: IBAN only
    expect(accountToIban("12AB", "Хаан банк")).toEqual({ error: "format" });
  });

  it("a typed legal or holder name is Mongolian Cyrillic, at least two words (2026-11-26)", () => {
    expect(cleanCyrillicName("  Батболдын   Тэмүүжин ")).toBe("Батболдын Тэмүүжин");
    expect(cleanCyrillicName("Гантулга Бат-Эрдэнэ")).toBe("Гантулга Бат-Эрдэнэ");
    expect(cleanCyrillicName("Ө. Үүрцайх")).toBe("Ө. Үүрцайх");
    expect(cleanCyrillicName("Bat-Erdene G.")).toBeNull(); // Latin
    expect(cleanCyrillicName("Тэмүүжин")).toBeNull(); // one word
    expect(cleanCyrillicName("fff")).toBeNull();
    expect(cleanCyrillicName("Бат 2")).toBeNull();
  });
});
