import { Plus } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import type { T } from "@/i18n";
import { NavLink } from "./nav-link";
import { Avatar } from "./ui";

/**
 * The web (tablet/desktop) top bar — PleaseHelp-style: logo, browse links, profile and the orange
 * "post" button. Phones keep their own header + bottom actions (hidden here below md).
 */
export function WebNav({ t, name, helper }: { t: T; name: string; helper: boolean }) {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-line bg-bg/95 backdrop-blur md:block">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 text-[19px] font-extrabold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-brand text-white">T</span>
          {APP_NAME}
        </Link>
        <nav className="flex items-center gap-1 text-[15px]">
          <NavLink href="/requests">{t("web.requests")}</NavLink>
          <NavLink href="/helpers">{t("web.helpers")}</NavLink>
          {helper && <NavLink href="/jobs">{t("tabs.jobs")}</NavLink>}
          {helper && <NavLink href="/earnings">{t("tabs.earnings")}</NavLink>}
          <NavLink href="/help">{t("info.navHelp")}</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/post" className="press flex min-h-11 items-center gap-1.5 rounded-[14px] bg-brand px-4 text-[15px] font-bold text-white">
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
