import { AppTabs } from "@/components/app-tabs";
import { space } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";

/**
 * Root tabs on phones (the web has its top bar). Customers: Нүүр · Захиалах · Даалгавар · Профайл;
 * helpers: Ажил · Орлого · Профайл (owner, 2026-11-24). Inside a flow (post, task, chat) there is no
 * tab bar — those pages show ✕ / ←.
 */
export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const mode = await getMode();
  return (
    <>
      <div className={`flex flex-1 flex-col ${space.blocks} pb-28 md:pb-8`}>{children}</div>
      <AppTabs mode={mode} />
    </>
  );
}
