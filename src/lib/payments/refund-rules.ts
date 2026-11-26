/**
 * When a wire refund request is sent (again). Mirrors `public.wire_refund_work`: a new request goes
 * at once; a failed one after a backoff of 1 min doubling up to 6 h; one wire took as "pending"
 * is only re-sent (same idempotency key) if no news came for an hour. 10 tries, then Ops.
 */
export const REFUND_MAX_ATTEMPTS = 10;
const HOUR = 3_600_000;

export interface RefundRow {
  status: string;
  attempts: number;
  provider_ref: string | null;
  updated_at: string;
}

export function refundBackoffMs(attempts: number): number {
  return Math.min(6 * HOUR, 60_000 * 2 ** attempts);
}

export function refundDue(r: RefundRow, now: number): boolean {
  if (r.attempts >= REFUND_MAX_ATTEMPTS) return false;
  if (r.attempts === 0) return true;
  const since = now - Date.parse(r.updated_at);
  if (r.status === "failed") return since >= refundBackoffMs(r.attempts);
  if (r.status === "pending") return r.provider_ref === null || since >= HOUR;
  return false;
}
