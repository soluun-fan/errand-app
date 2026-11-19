"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/sheet";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { Uuid, parseOr } from "@/lib/input";
import { CertificateInput, OrgApplicationInput, ubDay } from "@/lib/org-rules";
import { answerInvitation, applyOrganization, canManage, createDocSlot, inviteMember, leaveOrganization, removeMember, submitCertificate } from "@/lib/orgs";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

async function viewerOrLogin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Upload slot for an organisation's registration certificate or a trade certificate, in the viewer's own folder. */
export async function prepareDoc(kind: "org" | "cert", mime: string, bytes: number): Promise<{ path: string; token: string } | { error: string }> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  if (kind === "cert" && unverifiedHelpersTestMode) return { error: t("kyc.testDisabled") };
  if ((kind !== "org" && kind !== "cert") || !MIME.includes(mime) || !(typeof bytes === "number" && bytes > 0 && bytes <= MAX_BYTES)) return { error: t("kyc.errors.type") };
  if (kind === "cert" && !viewer.actor.helperApproved) return { error: t("error.forbidden") };
  return createDocSlot(viewer.profile.id, kind, mime);
}

export interface OrgForm {
  name: string;
  regNumber: string;
  kind: string;
  description: string;
  area: string;
  categories: string[];
  docPath: string;
  bank: string;
  accountNumber: string;
  holderName: string;
  consent: boolean;
}

export async function applyOrg(raw: OrgForm): Promise<{ error?: string }> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const parsed = OrgApplicationInput.safeParse(raw);
  if (!parsed.success) return { error: t("org.errors.invalid") };
  const r = await applyOrganization(viewer.profile.id, parsed.data);
  if (r === "file") return { error: t("org.errors.file") };
  if (r === "duplicate") return { error: t("org.errors.duplicate") };
  redirect("/profile?org=sent");
}

/** Owner / manager adds a worker by phone; the worker accepts on their profile. */
export async function inviteWorker(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const orgId = parseOr(Uuid, form.get("orgId"));
  if (!orgId || !(await canManage(orgId, viewer.profile.id))) return { error: t("error.forbidden") };
  const role = form.get("role") === "manager" ? "manager" : "worker";
  const r = await inviteMember(orgId, viewer.profile.id, String(form.get("phone") ?? ""), form.getAll("categories").map(String), role);
  if (r !== "ok") return { error: t(`org.invite.${r}`) };
  refresh();
  return { done: true };
}

export async function removeWorker(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const orgId = parseOr(Uuid, form.get("orgId"));
  const helperId = parseOr(Uuid, form.get("helperId"));
  if (!orgId || !helperId || !(await canManage(orgId, viewer.profile.id))) return { error: t("error.forbidden") };
  await removeMember(orgId, viewer.profile.id, helperId);
  refresh();
  return { done: true };
}

export async function answerInvite(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  const orgId = parseOr(Uuid, form.get("orgId"));
  if (!orgId || !(await answerInvitation(viewer.profile.id, orgId, form.get("accept") === "1"))) return { error: t("error.changed") };
  refresh();
  return { done: true };
}

export async function leaveOrg(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const viewer = await viewerOrLogin();
  const orgId = parseOr(Uuid, form.get("orgId"));
  if (orgId) await leaveOrganization(viewer.profile.id, orgId);
  refresh();
  return { done: true };
}

export interface CertForm {
  category: string;
  issuer: string;
  number: string;
  expiresOn: string;
  docPath: string;
  firstAid?: boolean;
}

export async function submitCert(raw: CertForm): Promise<{ error?: string }> {
  const viewer = await viewerOrLogin();
  const t = await getT();
  if (unverifiedHelpersTestMode) return { error: t("kyc.testDisabled") };
  if (!viewer.actor.helperApproved) return { error: t("error.forbidden") };
  const parsed = CertificateInput.safeParse(raw);
  if (!parsed.success || (parsed.data.expiresOn && parsed.data.expiresOn < ubDay(Date.now()))) return { error: t("cert.errors.invalid") };
  const r = await submitCertificate(viewer.profile.id, parsed.data);
  if (r === "file") return { error: t("org.errors.file") };
  if (r === "duplicate") return { error: t("cert.errors.duplicate") };
  if (r === "needsRecord") return { error: t("care.needsRecord") };
  refresh();
  return {};
}
