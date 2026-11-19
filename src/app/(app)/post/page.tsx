import { listSavedAddresses } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";
import { getDealForViewer, listMyTasks } from "@/lib/deals/queries";
import { CATEGORIES, DEFAULT_CONFIG, type CategoryId, type ErrandDeal } from "@/lib/engine";
import { EmptyState, FlowHeader, Note, btn } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getControls } from "@/lib/safety";
import { guessCategory } from "@/lib/category-guess";
import { loadKeywords } from "@/lib/content";
import { invitableHelper } from "@/lib/helper-profile";
import { Uuid, parseOr } from "@/lib/input";
import { liveCategories } from "@/lib/orgs";
import { pricingConfig } from "@/lib/pricing";
import { openTaskCount } from "@/lib/safety";
import Link from "next/link";
import { PostFlow, type Draft, type InviteTarget } from "./post-flow";

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
    minutes: x.minutes,
    tools: x.tools,
    pin: d.location,
    pickupPin: d.pickupLocation,
    price: String(d.postedFee),
    autoPick: x.autoPick,
    variety: x.variety,
    require: x.require ?? {},
  };
}

/** /post?cat=shop&title=… (tiles, home search) or /post?again=<taskId> (repeat a task). */
export default async function PostPage({ searchParams }: PageProps<"/post">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  // Ops paused new tasks (docs/decisions.md "Safety pack"): say so before anyone fills the form.
  const controls = await getControls();
  if (controls.postingPaused) {
    const t = await getT();
    return (
      <>
        <FlowHeader href="/" icon="✕" label={t("common.close")} />
        <EmptyState
          icon="⏸️"
          title={t("safety.postingPausedTitle")}
          body={t("safety.postingPaused")}
          action={
            <Link href="/" className={btn.secondary}>
              {t("safety.myTasks")}
            </Link>
          }
        />
      </>
    );
  }
  const [sp, tasks, saved, cfg, keywords, live, openTasks] = await Promise.all([
    searchParams,
    listMyTasks(viewer.profile.id),
    listSavedAddresses(),
    pricingConfig(),
    loadKeywords(),
    liveCategories(),
    openTaskCount(viewer.profile.id),
  ]);
  const title = typeof sp.title === "string" && sp.title.trim() ? sp.title.slice(0, DEFAULT_CONFIG.titleMax) : undefined;
  // /post?helper=<id>: a direct request to the helper whose profile this came from
  const helperId = typeof sp.helper === "string" ? parseOr(Uuid, sp.helper) : null;
  const h = helperId && helperId !== viewer.profile.id ? await invitableHelper(helperId) : null;
  const invite: InviteTarget | null = h && h.categories.length ? { id: h.id, name: h.name, categories: h.categories.filter((c) => live.includes(c)) } : null;
  // Asked for one helper who can't take requests now: say so — never quietly post to everyone instead.
  if (typeof sp.helper === "string" && (!invite || !invite.categories.length)) {
    const t = await getT();
    return (
      <>
        <FlowHeader href={helperId ? `/helpers/${helperId}` : "/helpers"} icon="✕" label={t("common.close")} />
        <EmptyState
          icon="🙅"
          title={t("invite.unavailableTitle")}
          body={t("invite.unavailable")}
          action={
            <Link href="/post" className={btn.secondary}>
              {t("invite.postToAll")}
            </Link>
          }
        />
      </>
    );
  }
  // a category from a tile, or guessed from the search text ("буйдан зөөх" → carry); can be changed
  let cat = (CATEGORIES.find((c) => c.id === sp.cat)?.id as CategoryId | undefined) ?? guessCategory(title, keywords) ?? undefined;
  let unavailable = Boolean(cat && !live.includes(cat));
  if (unavailable) cat = undefined;
  if (invite && cat && !invite.categories.includes(cat)) cat = undefined;
  if (invite && !cat && invite.categories.length === 1) cat = invite.categories[0];
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

  if (initial.category && (!live.includes(initial.category) || (invite && !invite.categories.includes(initial.category)))) {
    unavailable = true;
    delete initial.category;
    cat = undefined;
    again = false;
  }
  if (!live.length) return <EmptyState icon="⏸" title={(await getT())("specialized.unavailable")} />;
  return (
    <>
    {unavailable && <Note tone="warn">{(await getT())("specialized.unavailable")}</Note>}
    <PostFlow
      // a fresh form per source, so client state never leaks between repeats
      key={again ? `again-${sp.again}` : invite ? `invite-${invite.id}` : "new"}
      initial={initial}
      openTasks={openTasks}
      startStep={again ? 3 : cat ? 1 : 0}
      defaultAddress={saved.find((s) => s.kind === "home")?.address ?? viewer.profile.area ?? ""}
      recent={recent}
      saved={saved}
      cfg={cfg}
      live={live}
      invite={invite}
    />
    </>
  );
}
