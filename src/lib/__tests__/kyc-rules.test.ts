import { describe, expect, it } from "vitest";
import { cleanLegalName, isAdult, KYC_DOCS, maskAccount, normalizeAccount, payoutNameOk } from "@/lib/kyc-rules";

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
    expect(normalizeAccount("mn12 0005 0050 0512 3456")).toBe("MN120005005005123456"); // MN + 18 digits
    expect(normalizeAccount("MN12 0005 0050 0512 3456 78")).toBeNull(); // too long
    expect(normalizeAccount("5005-123-456")).toBe("5005123456");
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
});
