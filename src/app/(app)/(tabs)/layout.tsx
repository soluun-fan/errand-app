import { TabBar, type Tab } from "@/components/tab-bar";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";

/**
 * Root tabs. Helpers: Ажил · Орлого. Customers have one screen (Home: tasks, money, past tasks),
 * so no tab bar (docs/decisions.md 2026-11-15 "Fewer screens"). Inside a flow (post, task,
 * profile) there is no tab bar either — those pages show ✕ / ←.
 */
export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, mode] = await Promise.all([getT(), getMode()]);
  if (mode !== "helper") return <div className="flex flex-1 flex-col gap-4 pb-8">{children}</div>;

  const tabs: Tab[] = [
    { href: "/jobs", label: t("tabs.jobs"), icon: "🧭" },
    { href: "/earnings", label: t("tabs.earnings"), icon: "💰" },
  ];
  return (
    <>
      <div className="flex flex-1 flex-col gap-4 pb-28">{children}</div>
      <TabBar tabs={tabs} />
    </>
  );
}
