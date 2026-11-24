"use client";

import { Banknote, ClipboardList, Compass, House, Plus, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import type { T } from "@/i18n";
import { useT } from "@/i18n/client";
import { modeForPath, type AppMode } from "@/lib/mode-cookie";
import { TabBar, type Tab } from "./tab-bar";

export function AppTabs({ mode }: { mode: AppMode }) {
  const t = useT();
  // the tabs follow the screen (a deep link to /jobs shows helper tabs) without changing the saved
  // mode; from a helper's saved mode, Home switches back to customer mode on the way
  const shown = modeForPath(usePathname(), mode);
  return <TabBar tabs={appTabs(t, shown, mode)} />;
}

/**
 * The bottom tabs (owner, 2026-11-24: customers get a bar too, so past tasks and the profile are
 * easy to find). Customers: Home · Post (orange) · Tasks · Profile. Helpers: Jobs · Earnings · Profile.
 */
export function appTabs(t: T, mode: AppMode, saved: AppMode = mode): Tab[] {
  const icon = (I: typeof House) => <I aria-hidden size={22} />;
  return mode === "helper"
    ? [
        { href: "/jobs", label: t("tabs.jobs"), icon: icon(Compass) },
        { href: "/earnings", label: t("tabs.earnings"), icon: icon(Banknote) },
        { href: "/profile", label: t("tabs.profile"), icon: icon(UserRound) },
      ]
    : [
        { href: "/", label: t("tabs.home"), icon: icon(House), ...(saved === "helper" ? { switchMode: "customer" as const } : {}) },
        { href: "/post", label: t("tabs.post"), icon: icon(Plus), accent: true },
        { href: "/tasks", label: t("tabs.tasks"), icon: icon(ClipboardList) },
        { href: "/profile", label: t("tabs.profile"), icon: icon(UserRound) },
      ];
}
