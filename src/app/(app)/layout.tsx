import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

/** Everything inside (app) requires a signed-in user. 20 px side padding (docs/ui.md). */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!(await getViewer())) redirect("/login");
  return <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-5 pt-2">{children}</main>;
}
