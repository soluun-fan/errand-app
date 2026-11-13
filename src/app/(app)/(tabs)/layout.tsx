import { TabBar, type Tab } from "@/components/tab-bar";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { countNeedsAction } from "@/lib/deals/queries";
import { getMode } from "@/lib/mode";

/**
 * Root tabs only (DESIGN §4.14): customer Нүүр · Хэтэвч · Түүх, helper Ажил · Орлого · Түүх.
 * Inside a flow (post, task, profile) there is no tab bar — those pages show ✕ / ←.
 */
export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, mode, needsAction] = await Promise.all([getT(), getMode(), countNeedsAction(viewer.profile.id)]);

  const tabs: Tab[] =
    mode === "helper"
      ? [
          { href: "/jobs", label: t("tabs.jobs"), icon: "🧭" },
          { href: "/earnings", label: t("tabs.earnings"), icon: "💰" },
          { href: "/history", label: t("tabs.history"), icon: "🧾" },
        ]
      : [
          { href: "/", label: t("tabs.home"), icon: "🏠" },
          { href: "/wallet", label: t("tabs.wallet"), icon: "👛" },
          { href: "/history", label: t("tabs.history"), icon: "🧾", dot: needsAction > 0 },
        ];

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 pb-28">{children}</div>
      <TabBar tabs={tabs} />
    </>
  );
}
