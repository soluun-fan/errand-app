import { z } from "zod";
import { CATEGORIES, categoryTrust, type CategoryId, type Qualification } from "@/lib/engine";
import { KYC_LEVEL_BACKGROUND } from "@/lib/kyc-rules";

/**
 * Pure rules for organisations and specialized work (docs/decisions.md 2026-11-16 "Specialized
 * work"), unit-tested. They mirror `private.can_take_via` in the database, which refuses the same
 * things again if app code were ever wrong.
 */
export const ORG_KINDS = ["company", "agency", "ngo"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export type OrgStatus = "pending" | "approved" | "rejected" | "suspended";

/** The kinds an organisation or a certificate can cover (everything that isn't open work). */
export const SPECIALIZED: readonly CategoryId[] = CATEGORIES.filter((c) => c.trust !== "open").map((c) => c.id);
/** Kinds an individual certificate (trades) or care clearance (care, after the background check) can cover. */
export const CERTIFIABLE: readonly CategoryId[] = CATEGORIES.filter((c) => c.trust !== "open").map((c) => c.id); // care = a care clearance (needs the background check)

export interface MembershipFact {
  orgId: string;
  orgStatus: OrgStatus;
  orgKind: OrgKind;
  orgCategories: readonly CategoryId[];
  memberStatus: "invited" | "active" | "declined" | "removed";
  categories: readonly CategoryId[];
}
export interface CertificateFact {
  category: CategoryId;
  status: "pending" | "approved" | "rejected" | "expired";
  /** "YYYY-MM-DD" or null (no expiry). */
  expiresOn: string | null;
}

/** "YYYY-MM-DD" in Ulaanbaatar. */
export const ubDay = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Which specialized kinds a helper may take, and through whom (organisation first: it is paid
 * and answers for the work). Care needs an approved agency AND the criminal-record check.
 */
export function qualificationsFrom(f: { kycLevel: number; memberships: readonly MembershipFact[]; certificates: readonly CertificateFact[]; now: number }): Qualification[] {
  const out: Qualification[] = [];
  const today = ubDay(f.now);
  for (const category of SPECIALIZED) {
    const trust = categoryTrust(category);
    const viaOrgs = f.memberships.filter(
      (m) =>
        m.memberStatus === "active" &&
        m.orgStatus === "approved" &&
        m.categories.includes(category) &&
        m.orgCategories.includes(category) &&
        (trust !== "care" || (m.orgKind === "agency" && f.kycLevel >= KYC_LEVEL_BACKGROUND)),
    );
    for (const m of viaOrgs.sort((a, b) => a.orgId.localeCompare(b.orgId))) out.push({ category, orgId: m.orgId });
    const cert = f.certificates.some((c) => c.category === category && c.status === "approved" && (c.expiresOn === null || c.expiresOn >= today));
    // on their own: a trade certificate, or a care clearance — care also needs the criminal-record check
    if (cert && (trust === "pro" || (trust === "care" && f.kycLevel >= KYC_LEVEL_BACKGROUND))) out.push({ category, orgId: null });
  }
  return out;
}

const CategoryEnum = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]]);
const Specialized = CategoryEnum.refine((c) => SPECIALIZED.includes(c), "not a specialized kind");

export const OrgApplicationInput = z.object({
  name: z.string().trim().min(2).max(80),
  regNumber: z.string().trim().regex(/^[0-9]{7}$/),
  kind: z.enum(ORG_KINDS),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  area: z.string().trim().max(80).optional().transform((v) => v || null),
  categories: z.array(Specialized).min(1).max(SPECIALIZED.length).transform((c) => [...new Set(c)]),
  docPath: z.string().min(5).max(300),
  bank: z.string().trim().min(2).max(40),
  accountNumber: z.string().transform((v) => v.toUpperCase().replace(/[\s-]/g, "")).pipe(z.string().regex(/^(MN[0-9]{18}|[0-9]{6,20})$/)),
  holderName: z.string().trim().min(2).max(120),
  consent: z.literal(true),
}).refine((a) => a.kind === "agency" || !a.categories.some((c) => categoryTrust(c) === "care"), "care requires an agency");
export type OrgApplicationInput = z.infer<typeof OrgApplicationInput>;

export const CertificateInput = z.object({
  category: CategoryEnum.refine((c) => CERTIFIABLE.includes(c)),
  issuer: z.string().trim().min(2).max(120),
  number: z.string().trim().max(60).optional().transform((v) => v || null),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "invalid date")
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  docPath: z.string().min(5).max(300),
});
export type CertificateInput = z.infer<typeof CertificateInput>;

/** The kinds an organisation may vouch a worker for: only what Ops approved it for. */
export function memberCategories(requested: readonly string[], orgCategories: readonly CategoryId[]): CategoryId[] {
  return [...new Set(requested)].filter((c): c is CategoryId => orgCategories.includes(c as CategoryId));
}
