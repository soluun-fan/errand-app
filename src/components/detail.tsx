import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

/**
 * Task detail layout (docs/ui.md "D Detail"): edge-to-edge map on top, then white cards on the
 * light grey page (style B) — a category tag and big title, then one card per section.
 * Shared by the customer's task screen and the helper's job screen.
 */

/**
 * Full-bleed map at the top of the screen (cancels the page's side padding), with the back button
 * floating on it. The next card overlaps its bottom edge like a bottom sheet (`DetailTitle overlap`).
 */
export function MapHero({ children, caption, backHref, backLabel }: { children: ReactNode; caption?: ReactNode; backHref?: string; backLabel?: string }) {
  return (
    <div className="-mx-5 -mt-2 flex flex-col">
      <div className="relative">
        {children}
        {backHref && (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="press absolute left-4 top-[calc(0.75rem+env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-bg shadow-float"
          >
            <ArrowLeft aria-hidden size={20} />
          </Link>
        )}
        {/* one short live line on the map (e.g. "Bat is ~1.2 km away"), above the sheet's edge */}
        {caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 flex justify-center px-6">
            <span className="max-w-full rounded-full bg-bg px-4 py-2 text-center text-[13px] font-semibold shadow-float">{caption}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** "[🛒 Дэлгүүр] [● Нээлттэй]" over the big title. */
export function DetailTitle({ tag, status, title, children, overlap = false }: { tag: ReactNode; status?: ReactNode; title: string; children?: ReactNode; overlap?: boolean }) {
  return (
    <header className={`relative z-10 flex flex-col gap-2 bg-bg p-4 ${overlap ? "-mx-5 -mt-10 rounded-t-sheet px-5 pt-5 shadow-float" : "rounded-card shadow-card"}`}>
      {overlap && <span aria-hidden className="mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-line" />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-bg px-3 text-sm font-bold text-brand-ink">{tag}</span>
        {status}
      </div>
      <h1 className="text-[21px] font-bold leading-snug tracking-tight">{title}</h1>
      {children}
    </header>
  );
}

/** One labelled block on its own white card: small heading, then the value. */
export function DetailSection({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-1.5 rounded-card bg-bg p-4 shadow-card ${className}`}>
      <h2 className="text-[13px] font-semibold text-ink-2">{label}</h2>
      {children}
    </section>
  );
}

/**
 * The key facts as label | value rows split by thin lines (PleaseHelp-style "Price / When / Where"),
 * on one white card. Labels sit in a fixed column so the values line up.
 */
export function DetailRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col rounded-card bg-bg px-4 shadow-card">
      {rows.map((r, i) => (
        <div key={r.label} className={`grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
          <dt className="text-[14px] font-medium text-ink-2">{r.label}</dt>
          <dd className="min-w-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One address in a grey box: "● Авах газар" heading, the address, and Copy / Directions links on
 * the right. Without `address` (before matching) it shows `hidden` instead.
 */
export function AddressBox({
  icon,
  label,
  address,
  hidden,
  directionsUrl,
  directionsLabel,
}: {
  icon: ReactNode;
  label: string;
  address: string | null;
  hidden?: string;
  directionsUrl?: string;
  directionsLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-input bg-fill px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-bold">
          <span aria-hidden>{icon}</span> {label}
        </span>
        {address && (
          <span className="-my-2 -mr-2 flex items-center">
            <CopyButton text={address} label={label} />
            {directionsUrl && directionsLabel && (
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center px-2 text-[15px] font-semibold text-brand-ink underline underline-offset-4">
                {directionsLabel}
              </a>
            )}
          </span>
        )}
      </div>
      <p className={`text-[16px] ${address ? "text-ink" : "text-ink-2"}`}>{address ?? hidden}</p>
    </div>
  );
}
