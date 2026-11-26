import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState, btn } from "@/components/ui";
import { getT } from "@/i18n/server";

/** Any unknown address: a translated 404 with one way back (Next.js production checklist). */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5">
      <EmptyState
        icon={<SearchX aria-hidden size={28} />}
        title={t("common.notFoundTitle")}
        body={t("common.notFoundBody")}
        action={
          <Link href="/" className={btn.primary}>
            {t("common.goHome")}
          </Link>
        }
      />
    </main>
  );
}
