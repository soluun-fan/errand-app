import { answerPortfolioAction, askPortfolioAction, removeWorkPhotoAction, reportWorkPhotoAction } from "@/app/(app)/helpers/photo-actions";
import { Flag } from "lucide-react";
import type { T } from "@/i18n";
import { REPORT_REASONS, type TaskWorkPhoto } from "@/lib/work-photos";
import { InlineAction } from "./inline-action";
import { ConfirmSheet } from "./sheet";
import { btn } from "./ui";

type Candidate = { proofId: string; url: string | null; status: string | null; photoId: string | null };

const thumb = "aspect-square w-full rounded-input bg-fill object-cover";

/** A remove control for a public / requested photo (helper, customer or uploader). */
export function WorkPhotoRemove({ photoId, t }: { photoId: string; t: T }) {
  return (
    <ConfirmSheet
      action={removeWorkPhotoAction}
      fields={{ photoId }}
      trigger={t("workPhotos.remove")}
      triggerClass={`${btn.text} min-h-9 px-1 text-caption text-danger`}
      title={t("workPhotos.removeTitle")}
      body={t("workPhotos.removeBody")}
      confirmLabel={t("workPhotos.remove")}
      confirmClass={btn.danger}
    />
  );
}

/** Report a public photo (anyone signed in). */
export function WorkPhotoReport({ photoId, t }: { photoId: string; t: T }) {
  return (
    <ConfirmSheet
      action={reportWorkPhotoAction}
      fields={{ photoId }}
      // a quiet flag, not a second button competing with the card (the name stays for screen readers)
      trigger={
        <>
          <Flag aria-hidden size={15} />
          <span className="sr-only">{t("workPhotos.report")}</span>
        </>
      }
      triggerClass="flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-3 hover:bg-fill hover:text-ink-2"
      title={t("workPhotos.reportTitle")}
      confirmLabel={t("workPhotos.reportSend")}
    >
      <fieldset className="flex flex-col gap-2">
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex min-h-11 items-center gap-3 rounded-input bg-fill px-3">
            <input type="radio" name="reason" value={r} required />
            {t(`workPhotos.reasons.${r}`)}
          </label>
        ))}
      </fieldset>
    </ConfirmSheet>
  );
}

/**
 * The helper, on a finished job: pick photos for the portfolio; the customer is asked first.
 * Shows each photo's state (waiting / shown) so nobody asks twice.
 */
export function PortfolioAskSection({ dealId, candidates, t }: { dealId: string; candidates: Candidate[]; t: T }) {
  if (!candidates.length) return null;
  const free = candidates.filter((c) => c.status === null && c.url);
  const used = candidates.filter((c) => c.status !== null);
  const room = Math.max(0, 4 - used.length);
  return (
    <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <div>
        <h2 className="text-lead font-bold">{t("workPhotos.askTitle")}</h2>
        <p className="text-small text-ink-2">{t("workPhotos.askSub")}</p>
      </div>
      {used.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {used.map((c) => (
            <li key={c.proofId} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
              {c.url ? <img src={c.url} alt="" className={thumb} /> : <span className={thumb} />}
              <span className="text-caption text-ink-2">{t(`workPhotos.state.${c.status as "asked"}`)}</span>
              {(c.status === "asked" || c.status === "shown") && c.photoId && <WorkPhotoRemove photoId={c.photoId} t={t} />}
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && room > 0 && (
        <ConfirmSheet
          action={askPortfolioAction}
          fields={{ dealId }}
          trigger={t("workPhotos.askButton")}
          triggerClass={`${btn.secondary} self-start`}
          title={t("workPhotos.askTitle")}
          confirmLabel={t("workPhotos.askSend")}
        >
          <p className="rounded-input bg-warn-bg p-3 text-meta text-warn">{t("workPhotos.askRules")}</p>
          <p className="text-meta text-ink-2">{t("workPhotos.askUpTo", { n: room })}</p>
          <div className="grid grid-cols-3 gap-2">
            {free.map((c, i) => (
              <label key={c.proofId} className="relative cursor-pointer">
                <input type="checkbox" name="proofId" value={c.proofId} className="peer absolute left-2 top-2 h-5 w-5" />
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img src={c.url as string} alt={t("taskPhotos.alt", { n: i + 1 })} className={`${thumb} peer-checked:ring-4 peer-checked:ring-brand`} />
              </label>
            ))}
          </div>
        </ConfirmSheet>
      )}
    </section>
  );
}

/**
 * The customer, on a finished task: the helper's request to show photos (allow / no), and every
 * public photo of the task with a way to take it down.
 */
export function PortfolioConsentCard({ dealId, photos, helperName, t }: { dealId: string; photos: TaskWorkPhoto[]; helperName: string; t: T }) {
  const asked = photos.filter((p) => p.status === "asked");
  const shown = photos.filter((p) => p.status === "shown");
  if (!asked.length && !shown.length) return null;
  return (
    <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      {asked.length > 0 && (
        <>
          <div>
            <h2 className="text-lead font-bold">{t("workPhotos.consentTitle", { name: helperName })}</h2>
            <p className="text-small text-ink-2">{t("workPhotos.consentSub")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {asked.map((p, i) =>
              p.url ? (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                  <img src={p.url} alt={t("taskPhotos.alt", { n: i + 1 })} className={thumb} />
                </a>
              ) : (
                <span key={p.id} className={thumb} />
              ),
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <InlineAction action={answerPortfolioAction} fields={{ dealId, allow: "0" }} label={t("workPhotos.consentNo")} className={`${btn.secondary} w-full`} />
            <InlineAction action={answerPortfolioAction} fields={{ dealId, allow: "1" }} label={t("workPhotos.consentYes")} className={`${btn.primary} w-full`} />
          </div>
        </>
      )}
      {shown.length > 0 && (
        <>
          <h2 className="text-small font-semibold text-ink-2">{t("workPhotos.publicOfTask")}</h2>
          <ul className="grid grid-cols-3 gap-2">
            {shown.map((p, i) => (
              <li key={p.id} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- public work photo */}
                {p.url ? <img src={p.url} alt={t("taskPhotos.alt", { n: i + 1 })} className={thumb} /> : <span className={thumb} />}
                <span className="text-caption text-ink-2">{t(p.source === "review" ? "workPhotos.fromYourReview" : "workPhotos.inPortfolio")}</span>
                <WorkPhotoRemove photoId={p.id} t={t} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
