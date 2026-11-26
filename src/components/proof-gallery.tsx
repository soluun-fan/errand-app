import type { T } from "@/i18n";
import { fmtMoney } from "@/lib/format";

function caption(p: ProofView, t: T): string {
  if (p.kind === "receipt" && p.amount !== null) return t("proof.receiptAmount", { amount: fmtMoney(p.amount) });
  if (p.kind === "start") return t("proof.start");
  if (p.kind === "progress") return p.note ?? t("proof.progress");
  if (p.note === "check-out") return t("care.checkedOut");
  return t("proof.handover");
}

/** HH:mm in Ulaanbaatar — when the photo reached us (the order of events). */
const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" }).format(ms);
import type { ProofView } from "@/lib/proofs";
import { MapPin } from "lucide-react";

/** Proof photos / videos of a deal (signed URLs, valid 1 h), with reuse flags shown as warnings. */
export function ProofGallery({
  proofs,
  t,
  showFlags = true,
  action,
}: {
  proofs: ProofView[];
  t: T;
  showFlags?: boolean;
  /** Per-photo control (e.g. the helper's "remove"), rendered under the caption. */
  action?: (p: ProofView) => React.ReactNode;
}) {
  if (!proofs.length) return <p className="text-body text-ink-2">{t("proof.noneYet")}</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {proofs.map((p) => (
        <figure key={p.id} className={`flex flex-col gap-1 ${p.removed ? "opacity-60" : ""}`}>
          {p.url ? (
            p.isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- a silent proof clip of the work; nothing to caption
              <video src={p.url} controls playsInline preload="metadata" className="aspect-square w-full rounded-input bg-fill object-cover" />
            ) : (
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img src={p.url} alt={caption(p, t)} className="aspect-square w-full rounded-input bg-fill object-cover" />
              </a>
            )
          ) : p.note === "check-out" ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-input bg-fill text-display-lg" aria-hidden>
              <MapPin aria-hidden size={36} className="text-ink-3" />
            </div>
          ) : (
            <div className="aspect-square w-full rounded-input bg-fill" />
          )}
          <figcaption className="text-small text-ink-2">
            <span className="tabular-nums">{clock(p.at)}</span> · {caption(p, t)}
          </figcaption>
          {p.removed && <span className="rounded-input bg-fill px-2 py-1 text-caption font-medium text-ink-2">{t("proof.removedTag")}</span>}
          {action?.(p)}
          {showFlags &&
            p.flags.map((f) => (
              <span key={f} className="rounded-input bg-warn-bg px-2 py-1 text-caption font-medium text-warn">
                ⚠ {t(`proof.flag.${f as "reused_photo" | "similar_photo" | "old_file"}`)}
              </span>
            ))}
        </figure>
      ))}
    </div>
  );
}
