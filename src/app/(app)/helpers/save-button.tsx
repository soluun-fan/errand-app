import { Heart, LoaderCircle } from "lucide-react";
import { SubmitButton } from "@/components/sheet";
import type { T } from "@/i18n";
import { toggleSaved } from "./actions";

/** ♡ Save / ♥ Saved — a plain form, so it works before the page's JavaScript loads. */
/** `quiet`: outlined even when not saved (when another button is the main action). */
/** `icon`: just the heart in a square button beside the main action (PleaseHelp-style bar). */
export function SaveButton({ helperId, saved, t, className = "", quiet = false, icon = false }: { helperId: string; saved: boolean; t: T; className?: string; quiet?: boolean; icon?: boolean }) {
  const label = saved ? t("helperProfile.saved") : t("helperProfile.save");
  return (
    <form action={toggleSaved} className={className}>
      <input type="hidden" name="helperId" value={helperId} />
      <input type="hidden" name="on" value={saved ? "0" : "1"} />
      {icon ? (
        <SubmitButton
          aria-label={label}
          aria-pressed={saved}
          title={label}
          pendingContent={<LoaderCircle aria-hidden size={22} className="animate-spin" />}
          className="press flex h-14 w-14 items-center justify-center rounded-cta border border-line bg-bg text-brand-ink"
        >
          <Heart aria-hidden size={22} fill={saved ? "currentColor" : "none"} />
        </SubmitButton>
      ) : (
        <SubmitButton
          className={`press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-cta px-5 text-lead font-bold ${
            saved || quiet ? "border border-line bg-bg text-brand-ink" : "bg-brand text-white"
          }`}
        >
          <Heart aria-hidden size={18} fill={saved ? "currentColor" : "none"} />
          {label}
        </SubmitButton>
      )}
    </form>
  );
}
