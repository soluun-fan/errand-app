"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** A top-bar link that shows when you're on its page (or below it). */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const on = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-full px-3.5 font-medium ${on ? "bg-fill text-ink" : "text-ink-2 hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}
