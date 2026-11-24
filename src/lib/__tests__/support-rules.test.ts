import { expect, it } from "vitest";
import { checkSupport, cleanFacebook } from "@/lib/support-rules";

it("accepts a real message on a known topic, refuses empty, huge or unknown ones", () => {
  expect(checkSupport("payment", "  My refund   did not arrive  ")).toEqual({ ok: true, topic: "payment", message: "My refund did not arrive" });
  expect(checkSupport("payment", "help")).toEqual({ ok: false, reason: "short" });
  expect(checkSupport("payment", "x".repeat(1001))).toEqual({ ok: false, reason: "long" });
  expect(checkSupport("hack", "something long enough")).toEqual({ ok: false, reason: "topic" });
});

it("only https Facebook / Messenger links are shown as our page", () => {
  expect(cleanFacebook("https://www.facebook.com/guigeeree")).toBe("https://www.facebook.com/guigeeree");
  expect(cleanFacebook("https://m.me/guigeeree")).toBe("https://m.me/guigeeree");
  expect(cleanFacebook("http://facebook.com/x")).toBeNull();
  expect(cleanFacebook("https://evil.example/facebook.com")).toBeNull();
  expect(cleanFacebook("javascript:alert(1)")).toBeNull();
  expect(cleanFacebook("")).toBeNull();
});
