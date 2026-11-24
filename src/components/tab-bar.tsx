"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/i18n/client";
import type { AppMode } from "@/lib/mode-cookie";
import { setMode } from "@/lib/prefs";

export interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
  /** The main action (customers: post a task) — an orange button in the bar, never "current". */
  accent?: boolean;
  /** Tapping saves this as the home mode first (Home from a helper screen goes back to customer mode). */
  switchMode?: AppMode;
}

/** Floating pill tab bar, 3–4 equal items, root screens only (DESIGN §4.14). */
export function TabBar({ tabs }: { tabs: Tab[] }) {
  const t = useT();
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <nav aria-label={t("tabs.navigation")} className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center md:hidden px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <ul className="pointer-events-auto grid min-h-16 w-full max-w-sm auto-cols-fr grid-flow-col gap-1 rounded-[28px] border border-line bg-bg/90 p-1.5 shadow-float backdrop-blur">
        {tabs.map((tab) => {
          const on = !tab.accent && active(tab.href);
          const tone = tab.accent ? "bg-brand text-white" : on ? "bg-fill text-ink" : "text-ink-2";
          const className = `relative flex h-full min-h-13 w-full flex-col items-center justify-center gap-0.5 rounded-[22px] px-1 py-1 text-center text-xs font-semibold ${tone}`;
          const content = <>
            <span aria-hidden className="leading-none">{tab.icon}</span>
            <span className="w-full min-w-0 leading-tight [overflow-wrap:anywhere]">{tab.label}</span>
          </>;
          return (
            <li key={tab.href} className="min-w-0">
              {tab.switchMode ? (
                <form action={setMode} className="h-full">
                  <input type="hidden" name="mode" value={tab.switchMode} />
                  <button type="submit" className={className}>{content}</button>
                </form>
              ) : (
                <Link href={tab.href} aria-current={on ? "page" : undefined} className={className}>{content}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
