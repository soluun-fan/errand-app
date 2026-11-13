import { listSavedAddresses } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";
import { getDealForViewer, listMyTasks } from "@/lib/deals/queries";
import { CATEGORIES, DEFAULT_CONFIG, type CategoryId, type ErrandDeal } from "@/lib/engine";
import { PostFlow, type Draft } from "./post-flow";

/** The typed budget, without a paid top-up or the +10% buffer. */
function typedBudget(d: ErrandDeal): number {
  const base = d.itemBudget - (d.topUp?.status === "paid" ? d.topUp.amount : 0);
  return d.details.budgetBuffer ? Math.round((base * 10_000) / (10_000 + DEFAULT_CONFIG.budgetBufferBps)) : base;
}

/** "Дахин захиалах": everything from a past task; the price is recalculated for now. */
function draftFrom(d: ErrandDeal): Partial<Draft> {
  const x = d.details;
  return {
    category: d.category,
    title: d.title,
    description: d.description,
    pickup: d.pickupAddress ?? "",
    address: d.address,
    showDetails: Boolean(x.entrance || x.floor !== null || x.unit || x.lift || x.note),
    entrance: x.entrance ?? "",
    floor: x.floor === null ? "" : String(x.floor),
    unit: x.unit ?? "",
    lift: x.lift,
    note: x.note ?? "",
    km: x.km || 1,
    carryByHelper: x.carryByHelper,
    heavy: x.heavy,
    roundTrip: x.roundTrip,
    buyForMe: d.itemBudget > 0,
    itemBudget: d.itemBudget > 0 ? String(typedBudget(d)) : "",
    budgetBuffer: x.budgetBuffer,
    people: x.people,
    pin: d.location,
    autoPick: x.autoPick,
  };
}

/** /post?cat=shop&title=… (tiles, home search) or /post?again=<taskId> (repeat a task). */
export default async function PostPage({ searchParams }: PageProps<"/post">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [sp, tasks, saved] = await Promise.all([searchParams, listMyTasks(viewer.profile.id), listSavedAddresses()]);
  const cat = CATEGORIES.find((c) => c.id === sp.cat)?.id as CategoryId | undefined;
  const title = typeof sp.title === "string" && sp.title.trim() ? sp.title.slice(0, DEFAULT_CONFIG.titleMax) : undefined;
  const recent = [...new Set(tasks.map((x) => x.deal.address))].filter((a) => !saved.some((s) => s.address === a)).slice(0, 4);

  let initial: Partial<Draft> = { ...(cat ? { category: cat } : {}), ...(title ? { title } : {}) };
  let again = false;
  if (typeof sp.again === "string") {
    const past = await getDealForViewer(sp.again, viewer);
    if (past?.type === "errand" && past.customerId === viewer.profile.id) {
      initial = draftFrom(past);
      again = true;
    }
  }

  return (
    <PostFlow
      // a fresh form per source, so client state never leaks between repeats
      key={again ? `again-${sp.again}` : "new"}
      initial={initial}
      startStep={again ? 2 : 0}
      defaultAddress={saved.find((s) => s.kind === "home")?.address ?? viewer.profile.area ?? ""}
      recent={recent}
      saved={saved}
    />
  );
}
