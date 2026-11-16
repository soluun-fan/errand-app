import { Heart, Star } from "lucide-react";
import Link from "next/link";
import { Avatar, EmptyState, FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { helperProfile, savedHelperIds } from "@/lib/helper-profile";

/** /helpers — "My helpers": the customer's ♥ saved helpers, to find good people again. */
export default async function SavedHelpersPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  const ids = await savedHelperIds(viewer.profile.id);
  // a helper who is no longer approved simply drops out of the list
  const people = (await Promise.all(ids.map((id) => helperProfile(id)))).filter((p) => p !== null);
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("helperProfile.savedTitle")} />
      {people.length === 0 ? (
        <EmptyState icon="♡" title={t("helperProfile.savedEmpty")} body={t("helperProfile.savedEmptyBody")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={`/helpers/${p.id}`} className="press flex items-center gap-3 rounded-card bg-bg p-3 shadow-card">
                <Avatar name={p.name} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">{p.name}</span>
                  <span className="flex items-center gap-1 text-[13px] text-ink-2">
                    {p.rating !== null && (
                      <>
                        <Star aria-hidden size={13} className="fill-brand text-brand" /> {p.rating.toFixed(1)} ·{" "}
                      </>
                    )}
                    {t("deal.tasks", { n: p.completed })}
                  </span>
                </span>
                <Heart aria-hidden size={18} className="fill-current text-brand-ink" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
