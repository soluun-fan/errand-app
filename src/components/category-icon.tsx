import { Hourglass, Package, ShoppingBasket, Sofa, Sparkles, Wrench, type LucideIcon } from "lucide-react";
import type { CategoryId } from "@/lib/engine";

/** One consistent icon per category (Lucide, open source) — replaces the old emoji. */
export const CATEGORY_LUCIDE: Record<CategoryId, LucideIcon> = {
  shop: ShoppingBasket,
  deliver: Package,
  carry: Sofa,
  queue: Hourglass,
  repair: Wrench,
  other: Sparkles,
};

/** The category icon; `tile` puts it in a soft orange rounded square (lists, cards). */
export function CategoryIcon({ id, size = 20, tile = false, className = "" }: { id: CategoryId; size?: number; tile?: boolean; className?: string }) {
  const Icon = CATEGORY_LUCIDE[id];
  if (!tile) return <Icon aria-hidden size={size} strokeWidth={2} className={className} />;
  return (
    <span aria-hidden className={`flex flex-none items-center justify-center rounded-[12px] bg-brand-bg text-brand-ink ${className}`} style={{ width: size + 18, height: size + 18 }}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
