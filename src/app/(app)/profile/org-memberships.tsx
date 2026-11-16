"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { type ActionResult, SubmitButton } from "@/components/sheet";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { Invitation } from "@/lib/orgs";
import { answerInvite, leaveOrg } from "../orgs/actions";

export function Membership({ invitation, pending }: { invitation: Invitation; pending: boolean }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(pending ? answerInvite : leaveOrg, {});
  return (
    <form action={action} className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
      <input type="hidden" name="orgId" value={invitation.orgId} />
      <Link href={`/orgs/${invitation.orgId}`} className="font-semibold text-brand-ink">{invitation.orgName}</Link>
      {pending && <p className="text-sm">{t("org.join", { name: invitation.orgName, role: t(`org.roles.${invitation.role}`) })}</p>}
      <p className="text-sm text-ink-2">{invitation.categories.map((c) => t(`categoryShort.${c}`)).join(" · ")}</p>
      <p className="text-sm text-ink-2">{t("org.paidNote")}</p>
      {pending ? <AnswerButtons /> : invitation.role !== "owner" && <SubmitButton className={btn.text}>{t("org.leave")}</SubmitButton>}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

function AnswerButtons() {
  const { pending } = useFormStatus();
  const t = useT();
  return <div className="flex flex-wrap gap-2">
    <button name="accept" value="1" disabled={pending} className={btn.small}>{t("org.accept")}</button>
    <button name="accept" value="0" disabled={pending} className={btn.secondary}>{t("org.decline")}</button>
  </div>;
}
