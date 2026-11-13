"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Countdown } from "@/components/countdown";
import { BottomSheet, type ActionResult, type FormAction } from "@/components/sheet";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";

const BANKS = ["Khan Bank", "Golomt", "TDB", "State Bank", "M Bank", "Xac Bank"];

/**
 * UI-FLOWS C3: amount, bank grid (deeplinks later), QR for another phone, invoice countdown,
 * "Checking with the bank…", then a full-screen "held safely" tick before the page updates.
 */
export function PaySheet({
  dealId,
  amountLabel,
  payBy,
  serverNow,
  defaultOpen,
  mock,
  action,
  qr,
}: {
  dealId: string;
  amountLabel: string;
  payBy: number | null;
  serverNow: number;
  defaultOpen: boolean;
  mock: boolean;
  action: FormAction;
  qr: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});

  useEffect(() => {
    if (!state.done) return;
    const id = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(id);
  }, [state.done, router]);

  if (state.done) {
    return (
      <div role="status" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-held p-6 text-white">
        <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-4xl text-held">
          ✓
        </span>
        <p className="text-center text-2xl font-bold">{t("pay.held", { amount: amountLabel })}</p>
      </div>
    );
  }

  return (
    <>
      <button type="button" className={`${btn.primary} w-full`} onClick={() => setOpen(true)}>
        {t("pay.payNow", { amount: amountLabel })}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("pay.title", { amount: amountLabel })}>
        <p className="text-sm text-ink-2">{t("pay.sub")}</p>
        {payBy && (
          <p className="self-start rounded-full bg-warn-bg px-3 py-1 text-sm font-medium text-warn">
            <Countdown until={payBy} serverNow={serverNow} template={t("pay.validFor")} />
          </p>
        )}
        <form action={formAction} className="relative flex flex-col gap-3">
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="intent" value="simulate_payment" />
          <p className="text-sm font-semibold">{t("pay.chooseBank")}</p>
          <div className="grid grid-cols-3 gap-2">
            {BANKS.map((b) => (
              <BankButton key={b} name={b} disabled={!mock} />
            ))}
          </div>
          {mock && <p className="text-xs text-ink-2">{t("pay.demo")}</p>}
          <Checking />
          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
        </form>
        <div className="flex flex-col items-center gap-2 border-t border-line pt-3">
          <p className="text-sm text-ink-2">{t("pay.orScan")}</p>
          {qr}
        </div>
        <p className="rounded-input border border-warn/20 bg-warn-bg p-3 text-xs text-warn">{t("pay.screenshot")}</p>
      </BottomSheet>
    </>
  );
}

function BankButton({ name, disabled }: { name: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      name="bank"
      value={name}
      disabled={disabled || pending}
      className="press flex min-h-16 items-center justify-center rounded-input bg-fill px-2 text-center text-sm font-semibold hover:ring-2 hover:ring-ink disabled:opacity-50"
    >
      {name}
    </button>
  );
}

function Checking() {
  const { pending } = useFormStatus();
  const t = useT();
  if (!pending) return null;
  return (
    <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 rounded-input bg-white/90 text-sm font-semibold">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
      {t("pay.checking")}
    </div>
  );
}
