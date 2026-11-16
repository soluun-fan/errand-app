"use client";

import { useActionState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import type { Member } from "@/lib/orgs";
import { inviteWorker, removeWorker } from "../actions";

/** Owner / manager: add a worker by phone (they accept on their profile), and remove workers. */
export function ManageMembers({ orgId, kinds, members }: { orgId: string; kinds: CategoryId[]; members: Member[] }) {
  const t = useT();
  const [state, invite] = useActionState<ActionResult, FormData>(inviteWorker, {});
  const [removed, remove] = useActionState<ActionResult, FormData>(removeWorker, {});
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[17px] font-bold">{t("org.manage.title")}</h2>
      <form action={invite} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
        <input type="hidden" name="orgId" value={orgId} />
        <label className={fieldLabel}>
          {t("org.manage.phone")}
          <input name="phone" required inputMode="tel" className={`${field} tabular-nums`} placeholder="8800 0000" />
          <span className="text-[12px] font-normal text-ink-2">{t("org.manage.phoneHelp")}</span>
        </label>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-[14px] font-semibold">{t("org.manage.kinds")}</legend>
          {kinds.map((c) => (
            <label key={c} className="flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-[14px] has-[:checked]:border-brand has-[:checked]:bg-brand-bg">
              <input type="checkbox" name="categories" value={c} defaultChecked className="accent-brand" />
              <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
            </label>
          ))}
        </fieldset>
        <label className={fieldLabel}>
          {t("org.manage.role")}
          <select name="role" className={field} defaultValue="worker">
            <option value="worker">{t("org.roles.worker")}</option>
            <option value="manager">{t("org.roles.manager")}</option>
          </select>
        </label>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.done && <p className="text-sm text-held">{t("org.manage.sent")}</p>}
        <SubmitButton className={`${btn.primary} w-full`}>{t("org.manage.invite")}</SubmitButton>
      </form>

      <ul className="flex flex-col rounded-card bg-bg shadow-card">
        {members.map((m) => (
          <li key={m.helperId} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{m.name}</span>
              <span className="block text-[13px] text-ink-2">
                {t(`org.roles.${m.role}`)} · {m.status === "invited" ? t("org.manage.waiting") : m.categories.map((c) => t(`categoryShort.${c}`)).join(", ") || "—"}
                {m.categories.some((c) => c === "childcare" || c === "eldercare") && m.kycLevel < 4 ? ` · ${t("org.manage.needsRecord")}` : ""}
              </span>
            </span>
            {m.role !== "owner" && (
              <form action={remove}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="helperId" value={m.helperId} />
                <SubmitButton className={btn.text}>{t("org.manage.remove")}</SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
      {removed.error && <p className="text-sm text-danger">{removed.error}</p>}
    </section>
  );
}
