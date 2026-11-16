import { redirect } from "next/navigation";
import { WebNav } from "@/components/web-nav";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";

/**
 * Everything inside (app) requires a signed-in user. Phones: one 20 px-padded column (docs/ui.md).
 * Web (md+): a top bar and a wider reading column; browse pages go full width with <Wide>.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [t, mode] = await Promise.all([getT(), getMode()]);
  return (
    <>
      <WebNav t={t} name={viewer.profile.name ?? ""} helper={mode === "helper"} />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-5 pt-2 md:max-w-2xl md:pt-6">{children}</main>
    </>
  );
}
