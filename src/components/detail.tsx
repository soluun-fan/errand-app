import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

/**
 * Task detail layout (docs/ui.md "D Detail"): edge-to-edge map on top, then white cards on the
 * light grey page (style B) — a category tag and big title, then one card per section.
 * Shared by the customer's task screen and the helper's job screen.
 */

/** Full-bleed area under the header (cancels the page's 20 px side padding). */
export function MapHero({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <div className="-mx-5 -mt-2 flex flex-col">
      {children}
      {caption && <div className="px-5 pt-2 text-sm text-ink-2">{caption}</div>}
    </div>
  );
}

/** "[🛒 Дэлгүүр] [● Нээлттэй]" over the big title. */
export function DetailTitle({ tag, status, title, children }: { tag: ReactNode; status?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 rounded-card bg-bg p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-bg px-3 text-sm font-bold text-brand-ink">{tag}</span>
        {status}
      </div>
      <h1 className="text-[24px] font-bold leading-snug">{title}</h1>
      {children}
    </header>
  );
}

/** One labelled block on its own white card: small heading, then the value. */
export function DetailSection({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-1.5 rounded-card bg-bg p-4 ${className}`}>
      <h2 className="text-[15px] font-semibold text-ink-2">{label}</h2>
      {children}
    </section>
  );
}

/** Two values side by side (e.g. fee | items), split by a vertical line. */
export function DetailPair({ left, right }: { left: { label: string; value: ReactNode }; right: { label: string; value: ReactNode } }) {
  return (
    <dl className="grid grid-cols-2 rounded-card bg-bg p-4">
      <div className="flex flex-col gap-1 pr-3">
        <dt className="text-[15px] font-semibold text-ink-2">{left.label}</dt>
        <dd>{left.value}</dd>
      </div>
      <div className="flex flex-col gap-1 border-l border-line pl-3">
        <dt className="text-[15px] font-semibold text-ink-2">{right.label}</dt>
        <dd>{right.value}</dd>
      </div>
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
  icon: string;
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
