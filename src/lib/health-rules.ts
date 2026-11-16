/**
 * Is the background scheduler alive? (docs/decisions.md 2026-11-16 "System health"). The tick runs
 * every 20 s and writes a heartbeat; if nothing has run for 2 minutes, expiries, auto-releases and
 * SOS reminders are not happening — Ops must know. Pure, so it is unit-tested.
 */
export const TICK_STALE_MS = 2 * 60_000;

export interface HeartbeatRow {
  last_run_at: string;
  last_ok_at: string | null;
  last_error: string | null;
}

export type TickHealth =
  | { state: "ok"; agoMs: number }
  | { state: "never" }
  | { state: "stopped"; agoMs: number }
  | { state: "failing"; agoMs: number; error: string };

export function tickHealth(hb: HeartbeatRow | null, now: number): TickHealth {
  if (!hb) return { state: "never" };
  const ran = Date.parse(hb.last_run_at);
  const agoMs = Math.max(0, now - ran);
  if (!Number.isFinite(ran) || agoMs > TICK_STALE_MS) return { state: "stopped", agoMs: Number.isFinite(ran) ? agoMs : Infinity };
  const ok = hb.last_ok_at ? Date.parse(hb.last_ok_at) : NaN;
  if (hb.last_error && !(ok >= ran)) return { state: "failing", agoMs, error: hb.last_error };
  return { state: "ok", agoMs };
}
