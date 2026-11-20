import { describe, expect, it } from "vitest";
import { POSITION_FRESH_MS, desktopWorkAllowed, isMobileDevice, missingSteps } from "../work-ready-rules";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

describe("helpers work from a phone with notifications and location on", () => {
  it("allows desktop work only when the profile explicitly enables it", () => {
    expect(desktopWorkAllowed({ desktop_work_enabled: true })).toBe(true);
    expect(desktopWorkAllowed({ desktop_work_enabled: false })).toBe(false);
    expect(desktopWorkAllowed({})).toBe(false);
  });

  it("phones and tablets pass; desktop browsers don't", () => {
    expect(isMobileDevice(IPHONE)).toBe(true);
    expect(isMobileDevice(ANDROID)).toBe(true);
    expect(isMobileDevice(MAC)).toBe(false);
    expect(isMobileDevice(WIN)).toBe(false);
    expect(isMobileDevice(WIN, "?1")).toBe(true); // Client Hint says mobile
    expect(isMobileDevice(null)).toBe(false);
  });

  it("lists what's missing: phone, notifications, a position from the last 15 minutes", () => {
    const now = Date.now();
    expect(missingSteps({ userAgent: ANDROID, chMobile: null, pushDevices: 1, positionAt: now - 60_000, now })).toEqual([]);
    expect(missingSteps({ userAgent: MAC, chMobile: null, pushDevices: 0, positionAt: null, now })).toEqual(["phone", "notifications", "location"]);
    expect(missingSteps({ userAgent: IPHONE, chMobile: null, pushDevices: 2, positionAt: now - POSITION_FRESH_MS - 1, now })).toEqual(["location"]);
  });
});
