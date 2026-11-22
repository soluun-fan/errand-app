import { describe, expect, it } from "vitest";
import type { ErrandDeal } from "@/lib/engine";
import { pendingEarningsStage } from "../earnings-rules";

const job = { status: "check", payMode: "held", payeeOrgId: null, checkUntil: 200 } satisfies Pick<ErrandDeal, "status" | "payMode" | "payeeOrgId" | "checkUntil">;

describe("pending personal earnings", () => {
  it("never treats elapsed review time as money available to withdraw", () => {
    expect(pendingEarningsStage(job, 199)).toBe("review");
    expect(pendingEarningsStage(job, 200)).toBe("overdue");
    expect(pendingEarningsStage(job, 201)).toBe("overdue");
    expect(pendingEarningsStage({ ...job, checkUntil: null }, 201)).toBe("review");
  });

  it("keeps active work and disputes distinct from completion review", () => {
    for (const status of ["matched", "in_progress"] as const) {
      expect(pendingEarningsStage({ ...job, status }, 201)).toBe("work");
    }
    expect(pendingEarningsStage({ ...job, status: "disputed" }, 201)).toBe("disputed");
  });

  it("excludes money paid directly or owed to an organisation", () => {
    expect(pendingEarningsStage({ ...job, payMode: "direct" }, 0)).toBeNull();
    expect(pendingEarningsStage({ ...job, payeeOrgId: "org-1" }, 0)).toBeNull();
  });

  it("excludes unpaid matches, unassigned jobs and final outcomes", () => {
    for (const status of ["open", "awaiting_payment", "released", "refunded", "cancelled", "expired"] as const) {
      expect(pendingEarningsStage({ ...job, status }, 0)).toBeNull();
    }
  });
});
