import { describe, expect, it } from "vitest";
import { formatMnPhone, normalizeMnPhone } from "@/lib/phone";

describe("normalizeMnPhone", () => {
  it.each([
    ["88000001", "+97688000001"],
    ["8800 0001", "+97688000001"],
    ["+976 8800-0001", "+97688000001"],
    ["97688000001", "+97688000001"],
    ["(9911) 2233", "+97699112233"],
  ])("%s → %s", (input, out) => expect(normalizeMnPhone(input)).toBe(out));

  it.each(["", "1234567", "880000012", "12345678", "+1 415 212 7777", "8800abcd", "976880000"])("rejects %j", (input) =>
    expect(normalizeMnPhone(input)).toBeNull(),
  );
});

describe("formatMnPhone", () => {
  it("shows the local 4+4 form", () => {
    expect(formatMnPhone("+97688000001")).toBe("8800 0001");
    expect(formatMnPhone("97688000001")).toBe("8800 0001");
  });
});
