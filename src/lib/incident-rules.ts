/**
 * SOS and problem reports (docs/decisions.md 2026-11-15 "Safety pack"). Pure rules, shared by the
 * browser form and the server; the server re-checks everything.
 */
export const INCIDENT_KINDS = ["sos", "unsafe", "harassment", "theft", "damage", "scam", "other"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
/** What a person can pick in "Report a problem" (SOS has its own button). */
export const REPORT_KINDS = INCIDENT_KINDS.filter((k) => k !== "sos");

export const INCIDENT_NOTE_MAX = 1000;
export const REPORT_NOTE_MIN = 10;
/** Problem reports per person per hour (SOS is never limited — a repeat press updates the open one). */
export const REPORTS_PER_HOUR = 5;
/** Ops is pushed again about an SOS nobody has acknowledged: every 2 min for the first 30 min. */
export const SOS_REPING_MS = 2 * 60_000;
export const SOS_REPING_FOR_MS = 30 * 60_000;
/** Exact positions are deleted from incident records this long after they are resolved. */
export const INCIDENT_LOCATION_DAYS = 30;

/** Emergency numbers in Mongolia shown on the SOS sheet. */
export const EMERGENCY_NUMBERS = { police: "102", ambulance: "103", fire: "101" } as const;

/** Statuses where the two people may be together or about to meet → the SOS button is shown. */
export const SOS_STATUSES = ["awaiting_payment", "matched", "in_progress", "check"] as const;

export interface Position {
  lat: number;
  lng: number;
  accuracy: number | null;
}

/** A position from the browser, or null if it is missing or nonsense. Never blocks an SOS. */
export function cleanPosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng, accuracy } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const acc = typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(Math.round(accuracy), 100_000) : null;
  return { lat, lng, accuracy: acc };
}

export type ReportCheck = { ok: true; kind: IncidentKind; note: string } | { ok: false; reason: "kind" | "note" };

export function checkReport(kind: string, note: string): ReportCheck {
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: "kind" };
  const n = note.trim();
  if (n.length < REPORT_NOTE_MIN || n.length > INCIDENT_NOTE_MAX) return { ok: false, reason: "note" };
  return { ok: true, kind: kind as IncidentKind, note: n };
}

/** Should Ops get another reminder about this SOS now? */
export function needsReping(i: { kind: string; status: string; createdAt: number; lastPingAt: number }, now: number, everyMs = SOS_REPING_MS, forMs = SOS_REPING_FOR_MS): boolean {
  return i.kind === "sos" && i.status === "open" && now - i.createdAt <= forMs && now - i.lastPingAt >= everyMs;
}
