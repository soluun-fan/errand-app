"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface Tab {
  href: string;
  label: string;
  icon: string;
  /** Red dot: something here needs action (e.g. a check window is open). */
  dot?: boolean;
}

/** Floating pill tab bar, 3 items, root screens only (DESIGN §4.14). */
export function TabBar({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <ul className="pointer-events-auto grid h-16 w-full max-w-sm grid-cols-3 gap-1 rounded-full border border-line bg-bg/90 p-1.5 shadow-float backdrop-blur">
        {tabs.map((tab) => {
          const on = active(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-full text-xs font-semibold ${
                  on ? "bg-fill text-ink" : "text-ink-2"
                }`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {tab.icon}
                </span>
                {tab.label}
                {tab.dot && <span aria-hidden className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-danger" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
