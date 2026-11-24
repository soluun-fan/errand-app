import type { LucideIcon } from "lucide-react";

/**
 * A Lucide icon that sits inline with text (docs/ui.md: Lucide, never emoji for UI). Decorative:
 * the text next to it carries the meaning, so it is hidden from screen readers.
 */
export function Ico({ as: I, size = 18, className = "" }: { as: LucideIcon; size?: number; className?: string }) {
  return <I aria-hidden size={size} strokeWidth={2} className={`inline-block shrink-0 align-[-0.2em] ${className}`} />;
}
