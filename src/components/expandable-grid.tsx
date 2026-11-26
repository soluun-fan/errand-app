"use client";

import { ChevronDown } from "lucide-react";
import { Children, useState, type ReactNode } from "react";

/** Items shown on phones before "N more"; wider screens always show every item. */
const SHOWN = 6;

/**
 * A grid that shows the first 6 children on phones with a "N more" button. The children stay the
 * grid's direct items; only CSS hides the rest (tiles are `flex`, so wider screens show them again).
 */
export function ExpandableGrid({ children, className, more, less }: { children: ReactNode; className: string; more: string; less: string }) {
  const [open, setOpen] = useState(false);
  const extra = Children.count(children) - SHOWN;
  const folded = extra > 0 && !open ? "[&>*:nth-child(n+7)]:hidden md:[&>*:nth-child(n+7)]:flex" : "";
  return (
    <div className="flex flex-col gap-2">
      <div className={`${className} ${folded}`}>{children}</div>
      {extra > 0 && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 items-center justify-between gap-2 text-small font-semibold text-brand-ink md:hidden">
          {open ? less : more}
          <ChevronDown aria-hidden size={18} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
