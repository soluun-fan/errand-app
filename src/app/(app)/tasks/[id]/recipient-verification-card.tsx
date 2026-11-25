"use client";

import { useActionState, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/sheet";
import { Card, Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { RecipientVerificationOwnerView } from "@/lib/verify-mn";
import { createRecipientInvite, type RecipientInviteActionState } from "./recipient-actions";

const initial: RecipientInviteActionState = {};

export function RecipientVerificationCard({
  dealId,
  verification,
}: {
  dealId: string;
  verification: RecipientVerificationOwnerView | null;
}) {
  const t = useT();
  const [absoluteLink, setAbsoluteLink] = useState("");
  const [state, action] = useActionState(async (previous: RecipientInviteActionState, form: FormData) => {
    const next = await createRecipientInvite(previous, form);
    setAbsoluteLink(next.sharePath ? new URL(next.sharePath, window.location.origin).toString() : "");
    return next;
  }, initial);
  const status = state.status ?? verification?.status;
  const phone = state.phone ?? verification?.phone;
  const sharePath = state.sharePath;

  return (
    <Card>
      <div>
        <h2 className="text-lg font-bold">{t("verifyRecipient.title")}</h2>
        <p className="mt-1 text-sm text-ink-2">{t("verifyRecipient.ownerHelp")}</p>
      </div>
      {status === "VERIFIED" ? (
        <Note tone="held">{t("verifyRecipient.verified")}</Note>
      ) : (
        <>
          {status === "PENDING" && <Note tone="info">{t("verifyRecipient.pending")}</Note>}
          {status === "EXPIRED" && <Note tone="warn">{t("verifyRecipient.expired")}</Note>}
          {absoluteLink ? (
            <div className="flex flex-col gap-2 rounded-input bg-fill p-3">
              <p className="break-all text-sm" dir="ltr">
                {absoluteLink}
              </p>
              <CopyButton text={absoluteLink} />
              {phone && <p className="text-xs text-ink-2">{t("verifyRecipient.linkFor", { phone })}</p>}
            </div>
          ) : verification ? (
            <p className="text-sm text-ink-2">{t("verifyRecipient.linkLost")}</p>
          ) : null}
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="dealId" value={dealId} />
            <label className={fieldLabel}>
              {t("verifyRecipient.phone")}
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={field}
                placeholder="+976 8800 0001"
                defaultValue={phone}
                required
              />
            </label>
            <p className="text-sm text-ink-2">{t("verifyRecipient.ownerPrice")}</p>
            {state.error && (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            )}
            <SubmitButton className={`${btn.secondary} w-full`}>
              {sharePath || verification ? t("verifyRecipient.newLink") : t("verifyRecipient.createLink")}
            </SubmitButton>
          </form>
        </>
      )}
    </Card>
  );
}
