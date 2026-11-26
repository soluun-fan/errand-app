import { expect, it } from "vitest";
import { refundBackoffMs, refundDue } from "@/lib/payments/refund-rules";

const at = (msAgo: number) => new Date(1_000_000_000_000 - msAgo).toISOString();
const now = 1_000_000_000_000;

it("sends a new request at once", () => {
  expect(refundDue({ status: "pending", attempts: 0, provider_ref: null, updated_at: at(0) }, now)).toBe(true);
});
it("waits longer after each failure, up to 6 hours", () => {
  expect(refundBackoffMs(1)).toBe(120_000);
  expect(refundBackoffMs(9)).toBe(6 * 3_600_000);
  expect(refundDue({ status: "failed", attempts: 3, provider_ref: null, updated_at: at(7 * 60_000) }, now)).toBe(false);
  expect(refundDue({ status: "failed", attempts: 3, provider_ref: null, updated_at: at(9 * 60_000) }, now)).toBe(true);
});
it("does not resend a refund wire accepted until an hour passes without news", () => {
  expect(refundDue({ status: "pending", attempts: 1, provider_ref: "re_1", updated_at: at(10 * 60_000) }, now)).toBe(false);
  expect(refundDue({ status: "pending", attempts: 1, provider_ref: "re_1", updated_at: at(61 * 60_000) }, now)).toBe(true);
});
it("hands over to Ops after 10 tries and never resends finished ones", () => {
  expect(refundDue({ status: "failed", attempts: 10, provider_ref: null, updated_at: at(86_400_000) }, now)).toBe(false);
  expect(refundDue({ status: "succeeded", attempts: 1, provider_ref: "re_1", updated_at: at(86_400_000) }, now)).toBe(false);
  expect(refundDue({ status: "manual_required", attempts: 1, provider_ref: "re_1", updated_at: at(86_400_000) }, now)).toBe(false);
});
