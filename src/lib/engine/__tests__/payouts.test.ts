import { describe, expect, it } from "vitest";
import { EngineError, namesMatch, withdraw } from "../index";
import { T0 } from "./helpers";

describe("payout name matching", () => {
  it("matches the verified name regardless of case, spacing and dots (Cyrillic too)", () => {
    expect(namesMatch("Бат-Эрдэнэ Г.", "  бат-эрдэнэ   г")).toBe(true);
    expect(namesMatch("BAT-ERDENE G", "Bat-Erdene G.")).toBe(true);
    expect(namesMatch("Номин А", "Нямаа А")).toBe(false);
    expect(namesMatch("", "")).toBe(false);
  });

  it("the same person however the bank writes it (owner 2026-11-26)", () => {
    const id = "Энхтайван Солуун"; // овог, нэр — as on the ID card
    expect(namesMatch(id, "СОЛУУН ЭНХТАЙВАН")).toBe(true); // Golomt: given name first, capitals
    expect(namesMatch(id, "Э.Солуун")).toBe(true);
    expect(namesMatch(id, "Солуун Э.")).toBe(true);
    expect(namesMatch(id, "SOLUUN ENKHTAIVAN")).toBe(true); // Latin, MNS 5217
    expect(namesMatch(id, "Soluun Enhtaivan")).toBe(true); // kh written as h
    expect(namesMatch("Өлзийбат Гантулга", "GANTULGA ULZIIBAT")).toBe(true); // ө written as u
    expect(namesMatch("Бат-Эрдэнэ Ганбаатар", "БАТЭРДЭНЭ Г.")).toBe(true);
    // different people
    expect(namesMatch(id, "Энхтайван Сарнай")).toBe(false); // another given name
    expect(namesMatch(id, "Б. Солуун")).toBe(false); // another parent's initial
    expect(namesMatch(id, "Э. С.")).toBe(false); // initials only
    expect(namesMatch(id, "Солуун")).toBe(false); // a part missing
    expect(namesMatch("Номин А", "Нямаа А")).toBe(false);
  });
});

describe("withdraw", () => {
  const base = {
    userId: "h1",
    verifiedName: "Бат-Эрдэнэ Г.",
    available: 43600,
    amount: 43600,
    account: { holderName: "БАТ-ЭРДЭНЭ Г", bankRef: "M Bank ••••4417" },
    now: T0,
  };

  it("moves the balance from payable to the user's own bank account", () => {
    expect(withdraw(base)).toEqual({
      dealId: null,
      kind: "withdrawal",
      amount: 43600,
      from: "payable:h1",
      to: "ext:h1",
      providerRef: null,
      at: T0,
    });
  });

  it("blocks payouts to an account in someone else's name", () => {
    let err: unknown;
    try {
      withdraw({ ...base, account: { holderName: "Дорж Б.", bankRef: "Khan ••••0001" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("PAYOUT_BLOCKED");
  });

  it("rejects overdrafts, zero and fractional amounts", () => {
    expect(() => withdraw({ ...base, amount: 43601 })).toThrow(/only 43600/);
    expect(() => withdraw({ ...base, amount: 0 })).toThrow(/Nothing/);
    expect(() => withdraw({ ...base, amount: 100.5 })).toThrow(/integer/);
  });
});
