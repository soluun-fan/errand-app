import { Heart } from "lucide-react";
import { SubmitButton } from "@/components/sheet";
import type { T } from "@/i18n";
import { toggleSaved } from "./actions";

/** ♡ Save / ♥ Saved — a plain form, so it works before the page's JavaScript loads. */
/** `quiet`: outlined even when not saved (when another button is the main action). */
export function SaveButton({ helperId, saved, t, className = "", quiet = false }: { helperId: string; saved: boolean; t: T; className?: string; quiet?: boolean }) {
  return (
    <form action={toggleSaved} className={className}>
      <input type="hidden" name="helperId" value={helperId} />
      <input type="hidden" name="on" value={saved ? "0" : "1"} />
      <SubmitButton
        className={`press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-cta px-5 text-[16px] font-bold ${
          saved || quiet ? "border border-line bg-bg text-brand-ink" : "bg-brand text-white"
        }`}
      >
        <Heart aria-hidden size={18} fill={saved ? "currentColor" : "none"} />
        {saved ? t("helperProfile.saved") : t("helperProfile.save")}
      </SubmitButton>
    </form>
  );
}
