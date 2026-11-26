import Link from "next/link";
import { getT } from "@/i18n/server";

/**
 * Public information pages (help, safety, privacy): readable without an account — trust comes
 * before sign-up. Same column and look as the app; no login check.
 */
export default async function InfoLayout({ children }: LayoutProps<"/">) {
  const t = await getT();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 pb-16 pt-2">
      {children}
      <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-small text-ink-2">
        <Link href="/help" className="flex min-h-11 items-center hover:text-ink">
          {t("info.navHelp")}
        </Link>
        <Link href="/safety" className="flex min-h-11 items-center hover:text-ink">
          {t("info.navSafety")}
        </Link>
        <Link href="/privacy" className="flex min-h-11 items-center hover:text-ink">
          {t("info.navPrivacy")}
        </Link>
        <Link href="/terms" className="flex min-h-11 items-center hover:text-ink">
          {t("legal.termsTitle")}
        </Link>
        <Link href="/helper-terms" className="flex min-h-11 items-center hover:text-ink">
          {t("legal.helperTitle")}
        </Link>
      </nav>
    </main>
  );
}
