import type { ReactNode } from "react";

/**
 * Selectable cards (DESIGN §4.8, §4.9). Selected = 2 px ink border. These are plain
 * presentational buttons; the parent owns the state (works in client forms).
 */

/** Radio card with a price delta badge: "+1,500₮" / "+0₮". */
export function PriceDeltaCard({
  selected,
  onSelect,
  icon,
  title,
  sub,
  delta,
  free = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: string;
  title: string;
  sub?: string;
  delta?: string;
  free?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`press relative flex min-h-36 flex-col items-start gap-1.5 rounded-card p-3.5 text-left ${
        selected ? "border-2 border-ink" : "border border-line"
      }`}
    >
      <span className="flex w-full items-start justify-between">
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-input bg-fill text-2xl">
          {icon}
        </span>
        <span
          aria-hidden
          className={`mt-1 flex h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? "border-ink" : "border-ink-3"}`}
        >
          {selected && <span className="h-3 w-3 rounded-full bg-ink" />}
        </span>
      </span>
      <span className="text-[17px] font-semibold leading-tight">{title}</span>
      {sub && <span className="pb-6 text-sm text-ink-2">{sub}</span>}
      {delta && (
        <span
          className={`absolute bottom-2 right-2 rounded-lg px-2 py-0.5 text-sm font-semibold tabular-nums ${
            free ? "bg-eta-bg text-eta" : "bg-fill text-ink"
          }`}
        >
          {delta}
        </span>
      )}
    </button>
  );
}

/** Option row (ref 05): selected = bordered card; others plain rows; price right. */
export function OptionCard({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  meta,
  sub,
  price,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: string;
  title: string;
  meta?: string;
  sub?: ReactNode;
  price: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={`press flex w-full items-center gap-3 rounded-card p-3 text-left disabled:opacity-45 ${
        selected ? "border-2 border-ink" : "border-2 border-transparent"
      }`}
    >
      <span aria-hidden className="flex h-14 w-14 flex-none items-center justify-center rounded-input bg-fill text-2xl">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-medium">
          {title} {meta && <span className="text-sm font-normal text-ink-2">{meta}</span>}
        </span>
        {sub && <span className="block text-sm text-ink-2">{sub}</span>}
      </span>
      <span className="text-[20px] font-bold tabular-nums">{price}</span>
    </button>
  );
}

/** Dashed "+ Хаягийн дэлгэрэнгүй оруулах" that expands in place (DESIGN §4.11). */
export function DashedAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex min-h-12 w-full items-center gap-2 rounded-input border-[1.5px] border-dashed border-line bg-fill/60 px-4 text-left text-[15px] text-ink-2"
    >
      <span aria-hidden className="text-xl">
        +
      </span>
      {label}
    </button>
  );
}

/** Switch row (DESIGN §4.12). */
export function ToggleRow({ icon, title, sub, checked, onChange }: { icon: string; title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-card border border-line p-3">
      <span aria-hidden className="flex h-12 w-12 flex-none items-center justify-center rounded-input bg-fill text-2xl">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold">{title}</span>
        {sub && <span className="block text-sm text-ink-2">{sub}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-8 w-14 flex-none rounded-full bg-line transition-colors after:absolute after:left-1 after:top-1 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-6 peer-focus-visible:outline-2 peer-focus-visible:outline-ink"
      />
    </label>
  );
}
