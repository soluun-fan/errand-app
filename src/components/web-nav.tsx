"use client";

import { Plus } from "lucide-react";
import { APP_MARK, APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { modeForPath, type AppMode } from "@/lib/mode-cookie";
import { NavLink } from "./nav-link";
import { Avatar } from "./ui";

/**
 * The web (tablet/desktop) top bar — PleaseHelp-style: logo, browse links, profile and the orange
 * "post" button. Phones keep their own header + bottom actions (hidden here below md).
 */
export function WebNav({ name, mode }: { name: string; mode: AppMode }) {
  const t = useT();
  const helper = modeForPath(usePathname(), mode) === "helper";
  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-bg/95 backdrop-blur md:block">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2">
        <Link href={helper ? "/jobs" : "/"} className="flex shrink-0 items-center gap-2 text-[19px] font-extrabold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-brand text-white">{APP_MARK}</span>
          {APP_NAME}
        </Link>
        <nav aria-label={t("tabs.navigation")} className="order-last flex w-full flex-wrap items-center gap-1 text-[15px] xl:order-none xl:w-auto">
          {!helper && <NavLink href="/tasks">{t("tabs.tasks")}</NavLink>}
          <NavLink href="/requests">{t("web.requests")}</NavLink>
          <NavLink href="/helpers">{t("web.helpers")}</NavLink>
          {helper && <NavLink href="/jobs">{t("tabs.jobs")}</NavLink>}
          {helper && <NavLink href="/earnings">{t("tabs.earnings")}</NavLink>}
          <NavLink href="/help">{t("info.navHelp")}</NavLink>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Link href="/post" className="press flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[14px] bg-brand px-4 text-[15px] font-bold text-white">
            <Plus aria-hidden size={18} strokeWidth={2.5} />
            {t("landing.nav.post")}
          </Link>
          <Link href="/profile" aria-label={t("home.profile")} className="rounded-full">
            <Avatar name={name || "?"} size={40} />
          </Link>
        </div>
      </div>
    </header>
  );
}
