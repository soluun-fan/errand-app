import { getViewer } from "@/lib/auth";
import { listMyTasks } from "@/lib/deals/queries";
import { CATEGORIES, DEFAULT_CONFIG, type CategoryId } from "@/lib/engine";
import { PostFlow } from "./post-flow";

/** /post?cat=shop&title=… — tiles, the home search and "Дахин захиалах" prefill the flow. */
export default async function PostPage({ searchParams }: PageProps<"/post">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [sp, tasks] = await Promise.all([searchParams, listMyTasks(viewer.profile.id)]);
  const cat = CATEGORIES.find((c) => c.id === sp.cat)?.id as CategoryId | undefined;
  const title = typeof sp.title === "string" && sp.title.trim() ? sp.title.slice(0, DEFAULT_CONFIG.titleMax) : undefined;
  const recent = [...new Set(tasks.map((x) => x.deal.address))].slice(0, 4);

  return (
    <PostFlow
      initial={{ ...(cat ? { category: cat } : {}), ...(title ? { title } : {}) }}
      defaultAddress={viewer.profile.area ?? ""}
      recent={recent}
    />
  );
}
