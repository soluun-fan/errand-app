"use client";

import { APP_MARK } from "@/lib/brand";
import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/sheet";
import { Card, Note, btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { RecipientVerificationView } from "@/lib/verify-mn";
import { beginRecipientVerification, checkRecipientVerification, type RecipientVerificationActionState } from "./actions";

const initial: RecipientVerificationActionState = {};

export function RecipientVerification({
  token,
  verification,
  inviteValid,
}: {
  token: string;
  verification: RecipientVerificationView;
  inviteValid: boolean;
}) {
  const t = useT();
  const [view, setView] = useState(verification);
  const [linkValid, setLinkValid] = useState(inviteValid);
  const [error, setError] = useState("");
  const checking = useRef(false);
  const [, action] = useActionState(async (previous: RecipientVerificationActionState, form: FormData) => {
    const next = await beginRecipientVerification(previous, form);
    if (next.view) {
      setView(next.view);
      if (next.inviteValid !== undefined) setLinkValid(next.inviteValid);
    }
    if (next.error) {
      setError(
        t(
          next.error === "invalid"
            ? "verifyRecipient.invalidLink"
            : next.error === "limit"
              ? "verifyRecipient.tooManySessions"
              : "verifyRecipient.statusFailed",
        ),
      );
    }
    return next;
  }, initial);

  useEffect(() => {
    if (!linkValid || (view.status !== "PENDING" && view.status !== "CREATING")) return;
    let active = true;
    const timer = setInterval(async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const result = await checkRecipientVerification(token);
        if (!active) return;
        if (result.view) {
          setView(result.view);
          if (result.inviteValid !== undefined) setLinkValid(result.inviteValid);
        }
        if (result.error) setError(t(result.error === "invalid" ? "verifyRecipient.invalidLink" : "verifyRecipient.statusFailed"));
      } finally {
        checking.current = false;
      }
    }, 3_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [linkValid, t, token, view.status]);

  const showStart = linkValid && (view.status === "NOT_STARTED" || view.status === "EXPIRED");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-input bg-brand text-title font-bold text-white">{APP_MARK}</span>
        <h1 className="text-headline font-bold">{t("verifyRecipient.publicTitle")}</h1>
        <p className="text-body text-ink-2">{t("verifyRecipient.publicIntro")}</p>
      </header>
      <Card>
        {view.status === "VERIFIED" ? (
          <>
            <Note tone="held">{t("verifyRecipient.verified")}</Note>
            <p className="text-small text-ink-2">{t("verifyRecipient.publicDone")}</p>
          </>
        ) : !linkValid ? (
          <Note tone="warn">{t("verifyRecipient.inviteExpired")}</Note>
        ) : (
          <>
            {view.status === "EXPIRED" && <Note tone="warn">{t("verifyRecipient.expired")}</Note>}
            {view.status === "PENDING" && (
              <>
                <Note tone="info">{t("verifyRecipient.waiting")}</Note>
                {view.displayInstruction && (
                  <p className="whitespace-pre-wrap rounded-input bg-fill p-3 text-body">{view.displayInstruction}</p>
                )}
                {view.smsUri && (
                  <a
                    href={view.smsUri}
                    rel="noreferrer"
                    referrerPolicy="no-referrer"
                    className={`${btn.primary} w-full`}
                    onClick={() => setError("")}
                  >
                    {t("verifyRecipient.openSms")}
                  </a>
                )}
                <p className="text-small text-ink-2">{t("verifyRecipient.replyNote")}</p>
                {error && (
                  <p role="alert" className="text-small text-danger">
                    {error}
                  </p>
                )}
              </>
            )}
            {view.status === "CREATING" && <Note tone="info">{t("verifyRecipient.preparing")}</Note>}
            {showStart && (
              <>
                <p className="text-body text-ink-2">{t("verifyRecipient.senderRule")}</p>
                <Note tone="warn">{t("verifyRecipient.publicPrice")}</Note>
                {error && (
                  <p role="alert" className="text-small text-danger">
                    {error}
                  </p>
                )}
                <form action={action}>
                  <input type="hidden" name="token" value={token} />
                  <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t("common.working")}>
                    {view.status === "EXPIRED" ? t("verifyRecipient.tryAgain") : t("verifyRecipient.start")}
                  </SubmitButton>
                </form>
              </>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
