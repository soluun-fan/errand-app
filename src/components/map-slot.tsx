import type { ReactNode } from "react";

/**
 * Where the map goes in skeleton A (DESIGN §3). No map provider is chosen yet
 * (docs/decisions.md), so this draws a neutral, clearly decorative street pattern — no fake
 * helper positions, no fake ETA. Overlays (location pill, buttons) are passed as children.
 */
export function MapSlot({ children, className = "h-[38vh] min-h-56" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[#eef0ec] ${className}`}>
      <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="#eef0ec" />
        <g fill="#e2e6df">
          <rect x="20" y="20" width="90" height="60" rx="6" />
          <rect x="130" y="20" width="120" height="60" rx="6" />
          <rect x="270" y="20" width="110" height="60" rx="6" />
          <rect x="20" y="110" width="90" height="80" rx="6" />
          <rect x="270" y="110" width="110" height="80" rx="6" />
          <rect x="20" y="220" width="160" height="60" rx="6" />
          <rect x="200" y="220" width="180" height="60" rx="6" />
        </g>
        <rect x="130" y="110" width="120" height="80" rx="10" fill="#d9ead9" />
        <g stroke="#ffffff" strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M0 95 H400" />
          <path d="M0 205 H400" />
          <path d="M120 0 V300" />
          <path d="M260 0 V300" />
        </g>
      </svg>
      <span aria-hidden className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-ink shadow-float" />
      {children}
    </div>
  );
}

/** White pill over the map: "📍 Сүхбаатар, 1-р хороо ›" or "~13:15-д ирнэ" (DESIGN §4.13). */
export function MapPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-ink px-4 py-2 text-[15px] font-semibold text-white shadow-float">
      {children}
    </span>
  );
}
