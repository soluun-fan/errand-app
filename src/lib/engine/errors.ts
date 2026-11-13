export type EngineErrorCode =
  | "ILLEGAL_TRANSITION" // command not allowed in the deal's current status
  | "FORBIDDEN" // actor may not perform this command on this deal
  | "INVALID_INPUT" // bad amounts, missing fields, etc.
  | "PAYMENT_MISMATCH" // provider confirmed a different amount than is due
  | "PROOF_MISSING" // helper tried to finish without required proof
  | "PAYOUT_BLOCKED" // payout account name does not match verified name
  | "INVARIANT_BROKEN"; // internal bug: money would not balance

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export const fail = (code: EngineErrorCode, message: string): never => {
  throw new EngineError(code, message);
};

/** Throws unless `n` is a non-negative safe integer (money is always whole tögrög). */
export function assertMoney(n: unknown, field: string): asserts n is number {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
    throw new EngineError("INVALID_INPUT", `${field} must be a non-negative integer (₮), got ${String(n)}`);
  }
}
