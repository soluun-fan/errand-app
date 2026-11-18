"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { BANKS } from "@/lib/kyc-rules";
import { savePayout } from "./actions";

/** Bank, account number, account holder — the holder must be the helper themselves. */
export function BankForm({ next, holder }: { next: "jobs" | "profile"; holder: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<ActionResult, FormData>(savePayout, {});
  // kept in state: a refused save (e.g. someone else's name) must not wipe what was typed
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [name, setName] = useState(holder);
  return (
    <form
      // sent by hand: React clears a form after an action, which would wipe the entries on an error
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="next" value={next} />
      <label className={fieldLabel}>
        {t("kyc.bank")}
        <select name="bank" required value={bank} onChange={(e) => setBank(e.target.value)} className={field}>
          <option value="" disabled>
            {t("payout.pickBank")}
          </option>
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabel}>
        {t("kyc.account")}
        <input name="accountNumber" required inputMode="text" autoComplete="off" maxLength={30} value={account} onChange={(e) => setAccount(e.target.value)} className={`${field} tabular-nums`} />
      </label>
      <label className={fieldLabel}>
        {t("payout.holder")}
        <input name="holderName" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        <span className="text-[12px] font-normal text-ink-2">{t("payout.holderHelp")}</span>
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} w-full`}>
        {pending ? t("common.working") : t("payout.save")}
      </button>
    </form>
  );
}
