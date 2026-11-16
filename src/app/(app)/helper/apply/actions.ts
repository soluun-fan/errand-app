"use server";

import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES, type CategoryId } from "@/lib/engine";
import { createKycSlot, latestApplication, submitApplication } from "@/lib/kyc";
import { BANKS, KYC_DOCS, cleanLegalName, isAdult, normalizeAccount, payoutNameOk, type KycDoc } from "@/lib/kyc-rules";
import { KycFormInput, parseOr } from "@/lib/input";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Upload slot for one verification document, in the applicant's own folder. */
export async function prepareKycUpload(doc: string, mime: string, bytes: number): Promise<{ path: string; token: string } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (typeof doc !== "string" || typeof mime !== "string" || typeof bytes !== "number") return { error: t("kyc.errors.type") };
  if (!(KYC_DOCS as readonly string[]).includes(doc) || !MIME.includes(mime) || (mime === "application/pdf" && doc !== "record")) {
    return { error: t("kyc.errors.type") };
  }
  if (!(bytes > 0 && bytes <= MAX_BYTES)) return { error: t("kyc.errors.type") };
  if ((await latestApplication(viewer.profile.id))?.status === "submitted") return { error: t("kyc.errors.open") };
  return createKycSlot(viewer.profile.id, doc as KycDoc, mime);
}

export interface KycForm {
  legalName: string;
  birthDate: string;
  idLast4: string;
  categories: string[];
  files: Partial<Record<KycDoc, string>>;
  bank: string;
  accountNumber: string;
  holderName: string;
  consent: boolean;
}

/** Validates everything again on the server, then stores the application for Ops review. */
export async function submitKyc(raw: KycForm): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  const f = parseOr(KycFormInput, raw);
  if (!f) return { error: t("kyc.errors.files") };
  const legalName = cleanLegalName(String(f.legalName ?? ""));
  if (!legalName) return { error: t("kyc.errors.name") };
  if (!isAdult(String(f.birthDate ?? ""), new Date())) return { error: t("kyc.errors.age") };
  if (!/^\d{4}$/.test(String(f.idLast4 ?? ""))) return { error: t("kyc.errors.last4") };
  const ids = CATEGORIES.filter((c) => c.trust === "open").map((c) => c.id) as string[]; // specialized work: organisations / certificates
  const categories = [...new Set((f.categories ?? []).filter((c) => ids.includes(c)))] as CategoryId[];
  if (!categories.length) return { error: t("kyc.errors.categories") };
  const files = {} as Record<KycDoc, string>;
  for (const d of KYC_DOCS) {
    const p = f.files?.[d];
    if (typeof p !== "string" || !p) return { error: t("kyc.errors.files") };
    files[d] = p;
  }
  if (!(BANKS as readonly string[]).includes(f.bank)) return { error: t("kyc.errors.bank") };
  const account = normalizeAccount(String(f.accountNumber ?? ""));
  if (!account) return { error: t("kyc.errors.account") };
  const holder = cleanLegalName(String(f.holderName ?? ""));
  if (!holder || !payoutNameOk(legalName, holder)) return { error: t("kyc.errors.holder") };
  if (f.consent !== true) return { error: t("kyc.errors.consent") };

  const r = await submitApplication(viewer.profile.id, { legalName, idLast4: f.idLast4, birthDate: f.birthDate, categories, files, bank: f.bank, accountNumber: account, holderName: holder });
  if (!r.ok) return { error: t(r.reason === "open" ? "kyc.errors.open" : "kyc.errors.files") };

  // tell the operations team (admins) there's something to review
  const { data: admins } = await createAdminClient().from("profiles").select("id").eq("role", "admin");
  await notify((admins ?? []).map((a) => a.id as string), {
    title: "push.kycNewTitle",
    body: "push.kycNewBody",
    params: { name: viewer.profile.name || legalName },
    url: "/ops/helpers",
    tag: "kyc-queue",
  });
  redirect("/helper/apply");
}
