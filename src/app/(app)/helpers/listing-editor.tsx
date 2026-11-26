"use client";

import { Pencil } from "lucide-react";
import { useActionState, useState } from "react";
import { BottomSheet, SubmitButton, type ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { BIO_MAX, TRANSPORT, ageBandLabel, type Transport } from "@/lib/profile-rules";
import { saveListing } from "./actions";

/** The helper edits their own listing: intro, "from" price, experience, how they get around, and whether their age range shows. */
export function ListingEditor({
  bio,
  fromPrice,
  minPrice,
  experienceYears,
  transport,
  ownAgeBand,
  showAgeBand,
}: {
  bio: string | null;
  fromPrice: number | null;
  minPrice: number;
  experienceYears: number | null;
  transport: Transport[];
  ownAgeBand: number | null;
  showAgeBand: boolean;
}) {
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
          <label className={fieldLabel}>
            {t("listing.experience")}
            <input name="experienceYears" inputMode="numeric" maxLength={2} defaultValue={experienceYears === null ? "" : String(experienceYears)} placeholder="3" className={`${field} tabular-nums`} />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body font-medium text-ink-2">{t("listing.transport")}</legend>
            <div className="flex flex-wrap gap-2">
              {TRANSPORT.map((m) => (
                <label key={m} className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-bg px-3.5 text-body font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
                  <input type="checkbox" name="transport" value={m} defaultChecked={transport.includes(m)} className="sr-only" />
                  {t(`listing.transportModes.${m}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {/* the age range from the verified ID — never the birth date; off unless the helper turns it on */}
          {ownAgeBand !== null ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-input bg-fill p-3">
              <input type="checkbox" name="showAgeBand" defaultChecked={showAgeBand} className="mt-1 h-5 w-5 flex-none accent-brand" />
              <span>
                <span className="block text-body font-semibold">{t("listing.showAge", { band: ageBandLabel(ownAgeBand) })}</span>
                <span className="block text-small text-ink-2">{t("listing.showAgeHelp")}</span>
              </span>
            </label>
          ) : (
            <p className="text-small text-ink-2">{t("listing.ageAfterId")}</p>
          )}
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
