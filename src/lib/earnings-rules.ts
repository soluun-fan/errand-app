import type { ErrandDeal } from "@/lib/engine";

export type PendingEarningsStage = "work" | "review" | "overdue" | "disputed";

/** A review deadline never proves that the ledger has released the fee. */
export function pendingEarningsStage(
  job: Pick<ErrandDeal, "status" | "payMode" | "payeeOrgId" | "checkUntil">,
  now: number,
): PendingEarningsStage | null {
  if (job.payMode === "direct" || job.payeeOrgId) return null;
  switch (job.status) {
    case "matched":
    case "in_progress":
      return "work";
    case "check":
      return job.checkUntil !== null && job.checkUntil <= now ? "overdue" : "review";
    case "disputed":
      return "disputed";
    default:
      return null;
  }
}
