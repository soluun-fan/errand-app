import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineAction } from "@/components/inline-action";
import { FlowHeader, Note, btn, field } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { opsWorkPhotos } from "@/lib/work-photos";
import { hideWorkPhotoAction } from "../../helpers/photo-actions";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsPhotos.title");

/**
 * /ops/photos — every public work photo, reported ones first (docs/decisions.md 2026-11-18 "Work
 * photos"). Hiding deletes the public file and is logged. Admins only.
 */
export default async function OpsPhotosPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, photos] = await Promise.all([getT(), opsWorkPhotos()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsPhotos.title")} />
      <Note tone="info">{t("opsPhotos.help")}</Note>
      {photos.length === 0 && <p className="text-body text-ink-2">{t("opsPhotos.none")}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p) => (
          <li key={p.id} className={`flex flex-col gap-2 rounded-card bg-bg p-2 shadow-card ${p.reports > 0 ? "ring-2 ring-danger" : ""}`}>
            <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={t("opsPhotos.openPhoto")}>
              {/* eslint-disable-next-line @next/next/no-img-element -- public work photo */}
              <img src={p.url} alt="" className="aspect-square w-full rounded-input bg-fill object-cover" />
            </a>
            <p className="text-caption text-ink-2">
              {p.category ? t(`categoryShort.${p.category}`) : ""} · {t(p.source === "review" ? "opsPhotos.fromReview" : "opsPhotos.fromHelper")}
              {p.reports > 0 && <b className="text-danger"> · {t("opsPhotos.reports", { n: p.reports })}</b>}
            </p>
            <Link href={`/tasks/${p.dealId}`} className="text-caption font-semibold text-brand-ink underline">
              {t("opsPhotos.openTask")}
            </Link>
            <InlineAction action={hideWorkPhotoAction} fields={{ photoId: p.id }} label={t("opsPhotos.hide")} className={`${btn.secondary} w-full text-danger`}>
              <input name="reason" maxLength={300} aria-label={t("opsPhotos.reasonPh")} placeholder={t("opsPhotos.reasonPh")} className={field} />
            </InlineAction>
          </li>
        ))}
      </ul>
    </>
  );
}
