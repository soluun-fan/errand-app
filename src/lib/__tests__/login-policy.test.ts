import { describe, expect, it } from "vitest";
import { loginPolicy, type LoginEnv } from "@/lib/login-policy";

const prod = (o: Partial<LoginEnv> = {}): LoginEnv => ({ production: true, smsLive: false, showCodes: true, testPhones: ["+97688000001"], ...o });

describe("loginPolicy", () => {
  it("development: anyone, codes on screen if enabled", () => {
    expect(loginPolicy("+97699999999", { ...prod(), production: false })).toEqual({ allowed: true, showCode: true });
  });

  it("public deployment without real SMS: only listed test phones may sign in — nobody else can take over an account", () => {
    expect(loginPolicy("+97688000001", prod())).toEqual({ allowed: true, showCode: true });
    expect(loginPolicy("+97688000099", prod())).toEqual({ allowed: false, showCode: false }); // e.g. the Ops account
    expect(loginPolicy("+97688000001", prod({ showCodes: false }))).toEqual({ allowed: true, showCode: false });
    expect(loginPolicy("+97688000001", prod({ testPhones: [] }))).toEqual({ allowed: false, showCode: false });
  });

  it("with real SMS: everyone may sign in and codes are never shown", () => {
    expect(loginPolicy("+97699999999", prod({ smsLive: true }))).toEqual({ allowed: true, showCode: false });
  });
});
