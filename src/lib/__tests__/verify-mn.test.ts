import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createVerifyMnClient, pollVerifyMnSession, VerifyMnError } from "@/lib/verify-mn";

const expiresAt = "2026-11-19T06:00:05.000Z";
const status = (sessionStatus: "PENDING" | "VERIFIED" | "EXPIRED") => ({
  sessionId: "session-1",
  sessionStatus,
  callbackStatus: "PENDING" as const,
  verifiedAt: sessionStatus === "VERIFIED" ? "2026-11-19T06:00:01.000Z" : null,
  expiresAt,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Verify.MN", () => {
  it("polls PENDING until the provider confirms VERIFIED", async () => {
    let now = Date.parse("2026-11-19T06:00:00.000Z");
    const getStatus = vi.fn().mockResolvedValueOnce(status("PENDING")).mockResolvedValueOnce(status("VERIFIED"));
    const result = await pollVerifyMnSession("session-1", expiresAt, getStatus, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(result?.sessionStatus).toBe("VERIFIED");
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("returns failure when the session expires without verification", async () => {
    let now = Date.parse("2026-11-19T06:00:00.000Z");
    const getStatus = vi.fn().mockResolvedValue(status("PENDING"));
    const result = await pollVerifyMnSession("session-1", expiresAt, getStatus, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(result).toBeNull();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("retries transient status failures within the session deadline", async () => {
    let now = Date.parse("2026-11-19T06:00:00.000Z");
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(status("VERIFIED"));
    const result = await pollVerifyMnSession("session-1", expiresAt, getStatus, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(result?.sessionStatus).toBe("VERIFIED");
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when the API key is missing", async () => {
    vi.stubEnv("VERIFY_MN_API_KEY", "");
    const fetcher = vi.fn<typeof fetch>();
    const client = createVerifyMnClient(fetcher);

    await expect(client.createSession("+97688000001", "482916")).rejects.toThrow("VERIFY_MN_API_KEY is not set");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces an unauthorized API key without exposing it", async () => {
    vi.stubEnv("VERIFY_MN_API_KEY", "test-secret");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createVerifyMnClient(fetcher);

    await expect(client.createSession("+97688000001", "482916")).rejects.toMatchObject({
      name: "VerifyMnError",
      status: 401,
    } satisfies Partial<VerifyMnError>);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-secret" });
  });

  it("creates an MO session with digits-only phone and exact random-code text", async () => {
    vi.stubEnv("VERIFY_MN_API_KEY", "test-secret");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        sessionId: "session-1",
        phone: "97688000001",
        shortcode: "144773",
        text: "482916",
        smsUri: "sms:144773?body=482916",
        displayInstruction: "Send 482916 from this phone",
        expiresAt,
      }),
    );
    const client = createVerifyMnClient(fetcher);

    await client.createSession("+976 8800 0001", "482916");

    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.verify.mn/sessions");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ phone: "97688000001", text: "482916" });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-secret" });
  });
});
