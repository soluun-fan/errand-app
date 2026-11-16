import { Heart } from "lucide-react";
import { SubmitButton } from "@/components/sheet";
import type { T } from "@/i18n";
import { toggleSaved } from "./actions";

/** ♡ Save / ♥ Saved — a plain form, so it works before the page's JavaScript loads. */
export function SaveButton({ helperId, saved, t, className = "" }: { helperId: string; saved: boolean; t: T; className?: string }) {
  return (
    <form action={toggleSaved} className={className}>
      <input type="hidden" name="helperId" value={helperId} />
      <input type="hidden" name="on" value={saved ? "0" : "1"} />
      <SubmitButton
        className={`press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-cta px-5 text-[16px] font-bold ${
          saved ? "border border-line bg-bg text-brand-ink" : "bg-brand text-white"
        }`}
      >
        <Heart aria-hidden size={18} fill={saved ? "currentColor" : "none"} />
        {saved ? t("helperProfile.saved") : t("helperProfile.save")}
      </SubmitButton>
    </form>
  );
}
