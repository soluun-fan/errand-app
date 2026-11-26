"use client";

import { Pencil } from "lucide-react";
import { useActionState, useState } from "react";
import { BottomSheet, SubmitButton, type ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { BIO_MAX } from "@/lib/profile-rules";
import { saveListing } from "./actions";

/** The helper edits their own listing: a short intro and an optional "from" price. */
export function ListingEditor({ bio, fromPrice, minPrice }: { bio: string | null; fromPrice: number | null; minPrice: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(bio ?? "");
  const [state, action] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveListing(prev, form);
    if (r.done) setOpen(false);
    return r;
  }, {});
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn.secondary} w-full`}>
        <Pencil aria-hidden size={16} /> {bio || fromPrice ? t("listing.edit") : t("listing.add")}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("listing.title")}>
        <form action={action} className="flex flex-col gap-4">
          <label className={fieldLabel}>
            {t("listing.bio")}
            <textarea
              name="bio"
              rows={5}
              maxLength={BIO_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("listing.bioPh")}
              className={`${field} min-h-32 py-3 leading-relaxed`}
            />
            <span className="flex justify-between gap-3 text-caption font-normal text-ink-2">
              <span>{t("listing.noContacts")}</span>
              <span className="tabular-nums">
                {text.length}/{BIO_MAX}
              </span>
            </span>
          </label>
          <label className={fieldLabel}>
            {t("listing.fromPrice")}
            <input name="fromPrice" inputMode="numeric" defaultValue={fromPrice ? String(fromPrice) : ""} placeholder={String(minPrice)} className={`${field} tabular-nums`} />
            <span className="text-caption font-normal text-ink-2">{t("listing.fromPriceHelp")}</span>
          </label>
          {state.error && (
            <p role="alert" className="text-small text-danger">
              {state.error}
            </p>
          )}
          <SubmitButton className={`${btn.primary} w-full`}>{t("listing.save")}</SubmitButton>
        </form>
      </BottomSheet>
    </>
  );
}
