import type { T } from "@/i18n";
import type { ErrandDeal } from "@/lib/engine/types";
import { fmtClock } from "@/lib/format";

/** Matched → Paid (held) → Working → Check → Done (posting is free; pay once a helper accepts). */
const STEPS = [
  { key: "matched", events: ["accepted", "chosen"] },
  { key: "paid", events: ["paid"] },
  { key: "working", events: ["started"] },
  { key: "check", events: ["done"] },
  { key: "done", events: ["released"] },
] as const;

/** Index of the step in progress; STEPS.length when everything is finished; null when the deal closed early. */
export function trackerPosition(status: ErrandDeal["status"]): number | null {
  switch (status) {
    case "open":
      return 0;
    case "awaiting_payment":
      return 1;
    case "matched":
    case "in_progress":
      return 2;
    case "check":
    case "disputed":
      return 3;
    case "released":
      return 5;
    default:
      return null;
  }
}

export interface TrackerEvent {
  code: string;
  at: number;
}

export function StepTracker({
  status,
  events,
  t,
  compact = false,
}: {
  status: ErrandDeal["status"];
  events: TrackerEvent[];
  t: T;
  compact?: boolean;
}) {
  const pos = trackerPosition(status);
  if (pos === null) return null;
  const timeOf = (codes: readonly string[]) => events.find((e) => codes.includes(e.code))?.at;

  return (
    <ol aria-label={t("tracker.label")} className="grid grid-cols-5">
      {STEPS.map((s, i) => {
        const done = i < pos;
        const here = i === pos;
        const at = done ? timeOf(s.events) : undefined;
        return (
          <li key={s.key} aria-current={here ? "step" : undefined} className="relative flex flex-col items-center gap-1 text-center">
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute right-1/2 top-3 -z-0 h-0.5 w-full ${i <= pos ? "bg-ink" : "bg-line"}`}
              />
            )}
            <span
              className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                done
                  ? "bg-ink text-white"
                  : here
                    ? `border-2 border-ink bg-bg text-ink ${status === "disputed" ? "" : "animate-tracker"}`
                    : "bg-line text-ink-3"
              }`}
            >
              {done ? "✓" : here ? "₮" : ""}
            </span>
            {!compact && (
              <>
                <span className={`text-xs leading-tight ${here ? "font-bold text-ink" : done ? "text-ink" : "text-ink-2"}`}>
                  {t(`tracker.${s.key}`)}
                </span>
                <span className="h-4 text-[11px] text-ink-2 tabular-nums">{at ? fmtClock(at) : ""}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
