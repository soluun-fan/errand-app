import { ArrowLeft, ChevronRight, Lock, X, type LucideIcon } from "lucide-react";
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
  primary: `${base} min-h-14 rounded-cta bg-brand px-5 text-[18px] font-bold text-white disabled:bg-fill disabled:text-ink-3`,
  /** Compact dark button for inside cards (e.g. "Сонгох"). */
  small: `${base} min-h-12 rounded-input bg-ink px-4 text-[15px] text-white disabled:bg-fill disabled:text-ink-3`,
  secondary: `${base} min-h-12 rounded-input border border-line bg-bg px-4 text-[15px] text-ink disabled:text-ink-3`,
  /** 56×56 square left of the CTA (back / schedule). */
  square: `${base} h-14 w-14 flex-none rounded-cta bg-fill text-xl text-ink`,
  danger: `${base} min-h-14 rounded-cta bg-danger px-5 text-[17px] text-white disabled:bg-fill disabled:text-ink-3`,
  text: `${base} min-h-12 rounded-input px-3 text-[15px] text-ink underline-offset-4 hover:underline`,
  textDanger: `${base} min-h-12 rounded-input px-3 text-[15px] text-danger underline-offset-4 hover:underline`,
};

export const field =
  "w-full min-h-14 rounded-input border border-line bg-bg px-4 py-3 text-base text-ink outline-none placeholder:text-ink-3 focus:border-ink";
export const fieldLabel = "flex flex-col gap-1.5 text-[15px] font-medium text-ink-2";

/**
 * Lets a page use the full web width (69rem — lines up with the top bar's content) from inside the narrow app column, on md+ only.
 * Negative side margins = (column − target) / 2, so it stays centred; phones are untouched.
 */
export function Wide({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`md:mx-[calc((100%-min(69rem,100vw-3rem))/2)] ${className}`}>{children}</div>;
}

/** Title of a root (tab) screen. */
export const pageTitle = "pt-2 text-[24px] font-bold tracking-tight";

/** A row that opens another screen: icon, label, optional count, chevron. `card`: standalone; otherwise a row inside a list card. */
export function LinkRow({ href, icon: Icon, label, count, card = false }: { href: string; icon: LucideIcon; label: string; count?: number; card?: boolean }) {
  return (
    <Link href={href} className={`press flex min-h-14 items-center gap-3 px-4 ${card ? "rounded-card bg-bg shadow-card" : "border-b border-line last:border-b-0"}`}>
      <Icon aria-hidden size={18} className="shrink-0 text-brand-ink" />
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      {count !== undefined && <span className="text-sm tabular-nums text-ink-2">{count}</span>}
      <ChevronRight aria-hidden size={18} className="shrink-0 text-ink-2" />
    </Link>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card ${className}`}>{children}</section>;
}

export function Note({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <div className={`rounded-input border px-3.5 py-3 text-[15px] ${TONE_CLASS[tone]} ${className}`}>{children}</div>;
}

/** 🔒 "46,000₮ банкинд хадгалагдаж байна" — on every screen where money is held. */
export function HeldBadge({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 self-start rounded-full bg-held-bg px-3 py-1.5 text-sm font-semibold text-held">
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
      className="flex flex-none items-center justify-center rounded-full bg-fill text-sm font-bold text-ink"
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
      {title ? <h1 className="min-w-0 break-words px-2 py-2 text-center text-[17px] font-bold leading-snug">{title}</h1> : <span />}
      <span className="flex justify-end text-sm text-ink-2 tabular-nums">{right}</span>
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
        <span aria-hidden className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-fill text-3xl text-ink-2">
          {icon}
        </span>
      )}
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="max-w-sm text-[15px] text-ink-2">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Segmented control as links (server-friendly): e.g. History tabs. */
export function SegmentedLinks({ items, current }: { items: { key: string; href: string; label: string }[]; current: string }) {
  return (
    <nav className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-fill p-1">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center rounded-full text-[15px] font-semibold ${
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
  return `press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full px-4 text-[15px] font-medium ${
    selected ? "bg-ink text-white" : "border border-line bg-bg text-ink"
  }`;
}
