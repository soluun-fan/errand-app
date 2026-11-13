import type { ReactNode } from "react";
import { fmtMoney } from "@/lib/format";

export interface MoneyRow {
  label: ReactNode;
  amount: number;
  muted?: boolean;
}

/** Amounts come from the engine's pure functions — never computed here (CLAUDE.md §12). */
export function MoneyBreakdown({ rows, total, caption }: { rows: MoneyRow[]; total?: MoneyRow; caption?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-bg p-4">
      {rows.map((r, i) => (
        <div key={i} className={`flex justify-between gap-4 text-sm ${r.muted ? "text-ink-2" : ""}`}>
          <span className={r.muted ? "" : "text-ink"}>{r.label}</span>
          <span className="font-medium tabular-nums">{fmtMoney(r.amount)}</span>
        </div>
      ))}
      {total && (
        <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-bold">
          <span>{total.label}</span>
          <span className="tabular-nums">{fmtMoney(total.amount)}</span>
        </div>
      )}
      {caption && <p className="text-sm text-ink-2">{caption}</p>}
    </div>
  );
}
