"use server";

import { redirect } from "next/navigation";
import { isOnboarded } from "@/lib/legal-rules";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES, OPEN_CATEGORIES, type CategoryId } from "@/lib/engine";
import { createKycSlot, latestApplication, submitApplication } from "@/lib/kyc";
import { BANKS, KYC_DOCS, cleanCyrillicName, isAdult, accountToIban, payoutNameOk, type KycDoc } from "@/lib/kyc-rules";
import { KycFormInput, parseOr } from "@/lib/input";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAcceptance } from "@/lib/legal";
import { canUseUnverifiedHelperTest, unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { audit } from "@/lib/safety";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp"];

export interface TestHelperState {
  error?: string;
}

/** Upload slot for one verification document, in the applicant's own folder. */
export async function prepareKycUpload(doc: string, mime: string, bytes: number): Promise<{ path: string; token: string } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const t = await getT();
  if (unverifiedHelpersTestMode) return { error: t("kyc.testDisabled") };
  if (typeof doc !== "string" || typeof mime !== "string" || typeof bytes !== "number") return { error: t("kyc.errors.type") };
  if (!(KYC_DOCS as readonly string[]).includes(doc) || !MIME.includes(mime)) {
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
  agreement: boolean;
}

/** Validates everything again on the server, then stores the application for Ops review. */
export async function submitKyc(raw: KycForm): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding"); // actions can be called directly: same rule as the pages
  const t = await getT();
  if (unverifiedHelpersTestMode) return { error: t("kyc.testDisabled") };
  const f = parseOr(KycFormInput, raw);
  if (!f) return { error: t("kyc.errors.files") };
  const legalName = cleanCyrillicName(String(f.legalName ?? ""));
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
  const acct = accountToIban(String(f.accountNumber ?? ""), f.bank);
  if ("error" in acct) return { error: t(acct.error === "bank" ? "kyc.errors.accountBank" : "kyc.errors.account") };
  const account = acct.iban;
  const holder = cleanCyrillicName(String(f.holderName ?? ""));
  if (!holder || !payoutNameOk(legalName, holder)) return { error: t("kyc.errors.holder") };
  if (f.consent !== true) return { error: t("kyc.errors.consent") };
  if (f.agreement !== true) return { error: t("kyc.errors.agreement") };

  const r = await submitApplication(viewer.profile.id, { legalName, idLast4: f.idLast4, birthDate: f.birthDate, categories, files, bank: f.bank, accountNumber: account, holderName: holder });
  if (!r.ok) return { error: t(r.reason === "open" ? "kyc.errors.open" : "kyc.errors.files") };
  // the Helper service agreement they accepted, with its version (shown again if it changes)
  await recordAcceptance(viewer.profile.id, "helper");

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

/** Test-only helper enrollment; limited to phone-verified tester accounts and never claims ID review. */
export async function activateTestHelper(_prev: TestHelperState, form: FormData): Promise<TestHelperState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isOnboarded(viewer.profile)) redirect("/onboarding");
  const t = await getT();
  if (!canUseUnverifiedHelperTest()) return { error: t("kyc.testDisabled") };
  if (viewer.profile.role === "admin") return { error: t("error.forbidden") };
  if (!viewer.profile.age_confirmed_at) return { error: t("kyc.errors.age") };
  if (form.get("agreement") !== "on") return { error: t("kyc.errors.agreement") };

  const categories = [...new Set(form.getAll("categories").map(String).filter((value): value is CategoryId => (OPEN_CATEGORIES as readonly string[]).includes(value)))];
  if (categories.length === 0) return { error: t("kyc.errors.categories") };
  if ((await latestApplication(viewer.profile.id))?.status === "submitted") return { error: t("kyc.errors.open") };

  await recordAcceptance(viewer.profile.id, "helper");
  await createAdminClient()
    .from("profiles")
    .update({ role: "helper", helper_status: "approved", categories, test_helper: true })
    .eq("id", viewer.profile.id)
    .throwOnError();
  await audit(viewer.profile.id, "helper.test_activated", viewer.profile.id, { categories });
  redirect("/jobs");
}
