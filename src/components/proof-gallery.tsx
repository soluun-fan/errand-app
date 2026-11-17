import type { T } from "@/i18n";
import { fmtMoney } from "@/lib/format";

function caption(p: ProofView, t: T): string {
  if (p.kind === "receipt" && p.amount !== null) return t("proof.receiptAmount", { amount: fmtMoney(p.amount) });
  if (p.kind === "start") return t("proof.start");
  if (p.kind === "progress") return p.note ?? t("proof.progress");
  return t("proof.handover");
}

/** HH:mm in Ulaanbaatar — when the photo reached us (the order of events). */
const clock = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" }).format(ms);
import type { ProofView } from "@/lib/proofs";

/** Proof photos / videos of a deal (signed URLs, valid 1 h), with reuse flags shown as warnings. */
export function ProofGallery({ proofs, t, showFlags = true }: { proofs: ProofView[]; t: T; showFlags?: boolean }) {
  if (!proofs.length) return <p className="text-[15px] text-ink-2">{t("proof.noneYet")}</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {proofs.map((p) => (
        <figure key={p.id} className="flex flex-col gap-1">
          {p.url ? (
            p.isVideo ? (
              <video src={p.url} controls playsInline preload="metadata" className="aspect-square w-full rounded-input bg-fill object-cover" />
            ) : (
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img src={p.url} alt={caption(p, t)} className="aspect-square w-full rounded-input bg-fill object-cover" />
              </a>
            )
          ) : (
            <div className="aspect-square w-full rounded-input bg-fill" />
          )}
          <figcaption className="text-sm text-ink-2">
            <span className="tabular-nums">{clock(p.at)}</span> · {caption(p, t)}
          </figcaption>
          {showFlags &&
            p.flags.map((f) => (
              <span key={f} className="rounded-input bg-warn-bg px-2 py-1 text-xs font-medium text-warn">
                ⚠ {t(`proof.flag.${f as "reused_photo" | "similar_photo" | "old_file"}`)}
              </span>
            ))}
        </figure>
      ))}
    </div>
  );
}
