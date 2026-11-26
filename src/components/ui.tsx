import { ArrowLeft, ArrowRight, ChevronRight, Lock, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { TONE_CLASS, type Tone } from "@/lib/labels";

/**
 * Primitives (docs/ui.md). Touch targets ≥ 48 px; the primary CTA is 56 px, orange (style B).
 * One primary per screen; everything else is secondary (white), small (dark) or text.
 */
const base =
  "press inline-flex items-center justify-center gap-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed";
export const btn = {
  /** 56 px orange CTA. Disabled = fill + ink-3 (DESIGN §4.1). */
  primary: `${base} min-h-14 rounded-cta bg-brand px-5 text-title font-bold text-white disabled:bg-fill disabled:text-ink-3`,
  /** Compact dark button for inside cards (e.g. "Сонгох"). */
  small: `${base} min-h-12 rounded-input bg-ink px-4 text-body text-white disabled:bg-fill disabled:text-ink-3`,
  secondary: `${base} min-h-12 rounded-input border border-line bg-bg px-4 text-body text-ink disabled:text-ink-3`,
  /** 56×56 square left of the CTA (back / schedule). */
  square: `${base} h-14 w-14 flex-none rounded-cta bg-fill text-title-lg text-ink`,
  danger: `${base} min-h-14 rounded-cta bg-danger px-5 text-title text-white disabled:bg-fill disabled:text-ink-3`,
  text: `${base} min-h-12 rounded-input px-3 text-body text-ink underline-offset-4 hover:underline`,
  textDanger: `${base} min-h-12 rounded-input px-3 text-body text-danger underline-offset-4 hover:underline`,
};

export const field =
  "w-full min-h-14 rounded-input border border-line bg-bg px-4 py-3 text-lead text-ink outline-none placeholder:text-ink-3 focus:border-ink";
export const fieldLabel = "flex flex-col gap-1.5 text-body font-medium text-ink-2";

/**
 * Lets a page use the full web width (69rem — lines up with the top bar's content) from inside the narrow app column, on md+ only.
 * Negative side margins = (column − target) / 2, so it stays centred; phones are untouched.
 */
export function Wide({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`md:mx-[calc((100%-min(69rem,100vw-3rem))/2)] ${className}`}>{children}</div>;
}

/**
 * Spacing scale (docs/ui.md "Spacing"). A bigger gap means "less related". A gap between two
 * separate blocks is never smaller than the 20 px page edge, so nothing looks squeezed beside wide
 * margins on bigger screens.
 */
export const space = {
  /** between the sections of a page: 32 / 56 px */
  page: "gap-8 md:gap-14",
  /** between the blocks of a simple screen (Profile, Tasks, Jobs, Earnings — the tab layout): 24 / 32 px */
  blocks: "gap-6 md:gap-8",
  /** a section's title → its content, and between groups inside a section: 16 / 24 px */
  section: "gap-4 md:gap-6",
  /** cards in one list or grid, a label → its control: 12 px */
  group: "gap-3",
} as const;

/**
 * The Home and landing hero (PleaseHelp's layout, our look), one shape for both pages: a text column
 * of 576 px — measured so the title and paragraph letters end where the search box ends (mn and en),
 * so nothing in the column sticks out past the text. The side card is at most 320 px (owner, 2026-11-26) and sits on the
 * page's right edge; the space between them is never under 64 px and grows to ~208 px on wide screens,
 * so the two halves breathe instead of looking squeezed; they are centred against each other; a search box with a thin ink border (no shadow on wider screens) and small chips under it.
 */
export const hero = {
  grid: "grid grid-cols-1 gap-8 lg:grid-cols-[36rem_minmax(0,20rem)] lg:items-center lg:justify-between lg:gap-16",
  /**
   * Home's variant: the text column takes its width from the one-line title (any language, any
   * name), so the search box under it is exactly as wide as the letters above it.
   */
  gridFit: "grid grid-cols-1 gap-8 lg:grid-cols-[auto_minmax(0,20rem)] lg:items-center lg:justify-between lg:gap-16",
  /** inside gridFit: this row wraps within the title's width instead of widening the column */
  fitTitleWidth: "lg:w-0 lg:min-w-full",
  main: "flex min-w-0 flex-col gap-5",
  search:
    "flex min-h-14 items-center gap-2 rounded-cta bg-bg py-1.5 pl-4 pr-1.5 shadow-float md:min-h-16 md:border-2 md:border-ink md:shadow-none",
  searchGo: "press flex min-h-11 flex-none items-center justify-center gap-1.5 rounded-input bg-brand px-3 text-white md:min-h-12 md:px-5 md:text-lead md:font-bold",
  /** chip shape; add `hero.chipPlain` (or ink colours for the draft chip) */
  chip: "press inline-flex min-h-11 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-small font-medium md:min-h-10",
  chipPlain: "border-line bg-bg text-ink",
} as const;

/** Title of a root (tab) screen. */
export const pageTitle = "pt-2 text-headline font-bold tracking-tight";

/** "See all →" on the right of a section heading (a Link, or the landing page's login gate). */
export const seeAllClass = "flex min-h-12 shrink-0 items-center gap-1 text-small font-semibold text-brand-ink";
export const SeeAllArrow = () => <ArrowRight aria-hidden size={15} />;

/**
 * One heading for every content section (PleaseHelp-style): the title, an optional grey line under
 * it, and "See all →" on the right, bottom-aligned. `lg` is the public landing page's larger scale.
 */
export function SectionHeader({ title, sub, more, size = "md", id }: { title: string; sub?: string; more?: ReactNode; size?: "md" | "lg"; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className={size === "lg" ? "text-headline font-extrabold tracking-tight md:text-display" : "text-title font-bold tracking-tight md:text-headline"}>
          {title}
        </h2>
        {sub && <p className={`mt-1 text-ink-2 ${size === "lg" ? "text-body" : "text-small"}`}>{sub}</p>}
      </div>
      {more}
    </div>
  );
}

/** A row that opens another screen: icon, label, optional count, chevron. `card`: standalone; otherwise a row inside a list card. */
export function LinkRow({ href, icon: Icon, label, count, card = false }: { href: string; icon: LucideIcon; label: string; count?: number; card?: boolean }) {
  return (
    <Link href={href} className={`press flex min-h-14 items-center gap-3 px-4 ${card ? "rounded-card bg-bg shadow-card" : "border-b border-line last:border-b-0"}`}>
      <Icon aria-hidden size={18} className="shrink-0 text-brand-ink" />
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      {count !== undefined && <span className="text-small tabular-nums text-ink-2">{count}</span>}
      <ChevronRight aria-hidden size={18} className="shrink-0 text-ink-2" />
    </Link>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card ${className}`}>{children}</section>;
}

export function Note({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <div className={`rounded-input border px-3.5 py-3 text-body ${TONE_CLASS[tone]} ${className}`}>{children}</div>;
}

/** 🔒 "46,000₮ банкинд хадгалагдаж байна" — on every screen where money is held. */
export function HeldBadge({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full bg-held-bg px-3 py-1.5 text-small font-semibold text-held">
      <Lock aria-hidden size={14} className="shrink-0" />
      {children}
    </p>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const ini = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex flex-none items-center justify-center rounded-full bg-fill text-small font-bold text-ink"
    >
      {ini || "?"}
    </span>
  );
}

/** Flow header: ✕ or ← on the left, centred title, optional step counter (skeleton B). */
export function FlowHeader({ href, icon = "←", label, title, right }: { href: string; icon?: "←" | "✕"; label: string; title?: string; right?: ReactNode }) {
  return (
    <header className="grid min-h-14 grid-cols-[48px_1fr_48px] items-center">
      <Link href={href} aria-label={label} className="press flex h-12 w-12 items-center justify-center rounded-full bg-bg shadow-card">
        {icon === "✕" ? <X aria-hidden size={20} /> : <ArrowLeft aria-hidden size={20} />}
      </Link>
      {title ? <h1 className="min-w-0 break-words px-2 py-2 text-center text-title font-bold leading-snug">{title}</h1> : <span />}
      <span className="flex justify-end text-small text-ink-2 tabular-nums">{right}</span>
    </header>
  );
}

/** Sticky bottom bar: optional 56 px square on the left, one primary, optional line under it. */
export function PrimaryBar({ children, aboveTabs = false }: { children: ReactNode; aboveTabs?: boolean }) {
  return (
    <div
      className={`sticky z-10 -mx-5 mt-auto bg-canvas/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur ${
        aboveTabs ? "bottom-24" : "bottom-0"
      }`}
    >
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-card bg-fill ${className}`} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {icon && (
        <span aria-hidden className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-fill text-display text-ink-2">
          {icon}
        </span>
      )}
      <p className="text-title font-semibold">{title}</p>
      {body && <p className="max-w-sm text-body text-ink-2">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Segmented control as links (server-friendly): e.g. History tabs. */
export function SegmentedLinks({ items, current, label, keepScroll = false }: { items: { key: string; href: string; label: string }[]; current: string; label?: string; keepScroll?: boolean }) {
  return (
    <nav aria-label={label} className="flex gap-1 rounded-full bg-fill p-1">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          scroll={!keepScroll}
          aria-current={i.key === current ? "page" : undefined}
          className={`flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 text-body font-semibold ${
            i.key === current ? "bg-bg text-ink shadow-float" : "text-ink-2"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Horizontal filter / choice chips. Selected = ink (DESIGN §4.6). */
export function chipClass(selected: boolean) {
  return `press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full px-4 text-body font-medium ${
    selected ? "bg-ink text-white" : "border border-line bg-bg text-ink"
  }`;
}
