import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callAllowed, decodeCallLog, encodeCallLog, hadRealCall, validSdp } from "@/lib/call-rules";
import { turnCredentials } from "@/lib/turn";

describe("call rules", () => {
  it("calls while choosing (with an applicant) and during a live task — not after it ends, not in a dispute", () => {
    for (const s of ["open", "awaiting_payment", "matched", "in_progress", "check"] as const) expect(callAllowed(s)).toBe(true);
    for (const s of ["disputed", "released", "refunded", "cancelled", "expired"] as const) expect(callAllowed(s)).toBe(false);
  });

  it("relays only plausible SDP of sane size", () => {
    expect(validSdp("v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n")).toBe(true);
    expect(validSdp("<script>")).toBe(false);
    expect(validSdp("v=0" + "x".repeat(20_000))).toBe(false);
    expect(validSdp(42)).toBe(false);
  });

  it("call log lines round-trip", () => {
    for (const c of [
      { kind: "missed", video: false },
      { kind: "declined", video: true },
      { kind: "failed", video: false },
      { kind: "ended", video: true, seconds: 133 },
    ] as const) {
      expect(decodeCallLog(encodeCallLog(c))).toEqual(c);
    }
    expect(decodeCallLog("hello")).toBeNull();
  });
});

describe("TURN REST credentials", () => {
  it("are time-limited and verifiable by the relay with the shared secret", () => {
    const { username, credential } = turnCredentials("s3cret", "user-1", 1_700_000_000_000, 600);
    expect(username).toBe("1700000600:user-1");
    expect(credential).toBe(createHmac("sha1", "s3cret").update(username).digest("base64"));
    expect(turnCredentials("other", "user-1", 1_700_000_000_000).credential).not.toBe(credential);
  });
});

describe("care work: a real call before choosing", () => {
  it("needs an answered call of at least 30 seconds; missed, declined or short calls don't count", () => {
    expect(hadRealCall(["call:ended:voice:45"])).toBe(true);
    expect(hadRealCall(["call:ended:video:30"])).toBe(true);
    expect(hadRealCall(["call:ended:voice:12", "call:missed:voice", "call:declined:video", "hello"])).toBe(false);
    expect(hadRealCall([])).toBe(false);
  });
});
