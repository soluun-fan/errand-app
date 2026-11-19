import { describe, expect, it } from "vitest";
import { CertificateInput, OrgApplicationInput, memberCategories, qualificationsFrom, type MembershipFact } from "@/lib/org-rules";

const NOW = Date.UTC(2026, 10, 17, 4);
const org = (over: Partial<MembershipFact> = {}): MembershipFact => ({
  orgId: "o1",
  orgStatus: "approved",
  orgKind: "agency",
  orgCategories: ["plumbing", "electrical", "childcare"],
  memberStatus: "active",
  categories: ["plumbing", "childcare"],
  ...over,
});

describe("who may take specialized work (docs/decisions.md 2026-11-16 \"Specialized work\")", () => {
  it("an active worker of an approved organisation, for what both the org and the worker are approved for", () => {
    expect(qualificationsFrom({ kycLevel: 3, memberships: [org()], certificates: [], now: NOW })).toEqual([{ category: "plumbing", orgId: "o1" }]);
  });
  it("care also needs the criminal-record check (level 4)", () => {
    expect(qualificationsFrom({ kycLevel: 4, memberships: [org()], certificates: [], now: NOW })).toEqual([
      { category: "plumbing", orgId: "o1" },
      { category: "childcare", orgId: "o1" },
    ]);
  });
  it("a company or NGO cannot qualify caregivers even with a background check", () => {
    for (const orgKind of ["company", "ngo"] as const) {
      expect(qualificationsFrom({ kycLevel: 4, memberships: [org({ orgKind })], certificates: [], now: NOW }))
        .toEqual([{ category: "plumbing", orgId: "o1" }]);
    }
  });
  it("nothing through a pending / suspended organisation or an invite not yet accepted", () => {
    for (const m of [org({ orgStatus: "pending" }), org({ orgStatus: "suspended" }), org({ memberStatus: "invited" }), org({ memberStatus: "removed" })]) {
      expect(qualificationsFrom({ kycLevel: 4, memberships: [m], certificates: [], now: NOW })).toEqual([]);
    }
  });
  it("on their own: an approved, unexpired certificate (trades) or care clearance (only with the background check)", () => {
    const certificates = [
      { category: "electrical", status: "approved", expiresOn: "2027-01-01" },
      { category: "plumbing", status: "approved", expiresOn: "2026-11-16" }, // expired yesterday (UB)
      { category: "cleaning", status: "pending", expiresOn: null },
      { category: "childcare", status: "approved", expiresOn: null }, // a care clearance from Ops
    ] as const;
    expect(qualificationsFrom({ kycLevel: 4, memberships: [], certificates: [...certificates], now: NOW })).toEqual([
      { category: "electrical", orgId: null },
      { category: "childcare", orgId: null },
    ]);
    // without the criminal-record check a care clearance counts for nothing
    expect(qualificationsFrom({ kycLevel: 3, memberships: [], certificates: [...certificates], now: NOW })).toEqual([{ category: "electrical", orgId: null }]);
  });
  it("keeps every valid route, with organisations first for new offers", () => {
    const q = qualificationsFrom({ kycLevel: 3, memberships: [org()], certificates: [{ category: "plumbing", status: "approved", expiresOn: null }], now: NOW });
    expect(q).toEqual([{ category: "plumbing", orgId: "o1" }, { category: "plumbing", orgId: null }]);
  });
  it("an organisation can only vouch for what Ops approved it for", () => {
    expect(memberCategories(["plumbing", "cleaning", "plumbing", "shop"], ["plumbing", "electrical"])).toEqual(["plumbing"]);
  });
});

describe("input checks", () => {
  const app = { name: "Ус Сантехник ХХК", regNumber: "1234567", kind: "company", categories: ["plumbing"], docPath: "docs/u/x.pdf", bank: "Хаан банк", accountNumber: "5000 1234 56", holderName: "Ус Сантехник ХХК", consent: true };
  it("organisation: 7-digit registration number, specialized kinds only, consent", () => {
    expect(OrgApplicationInput.parse(app)).toMatchObject({ regNumber: "1234567", accountNumber: "5000123456", description: null });
    expect(OrgApplicationInput.safeParse({ ...app, regNumber: "123456" }).success).toBe(false);
    expect(OrgApplicationInput.safeParse({ ...app, categories: ["shop"] }).success).toBe(false);
    expect(OrgApplicationInput.safeParse({ ...app, categories: [] }).success).toBe(false);
    expect(OrgApplicationInput.safeParse({ ...app, consent: false }).success).toBe(false);
    expect(OrgApplicationInput.safeParse({ ...app, categories: ["childcare"] }).success).toBe(false);
    expect(OrgApplicationInput.safeParse({ ...app, kind: "agency", categories: ["childcare"] }).success).toBe(false);
  });
  it("certificate: launch trades only, optional expiry date", () => {
    const c = { category: "electrical", issuer: "Эрчим хүчний зохицуулах хороо", docPath: "docs/u/c.pdf", expiresOn: "" };
    expect(CertificateInput.parse(c)).toMatchObject({ expiresOn: null, number: null });
    expect(CertificateInput.safeParse({ ...c, category: "childcare" }).success).toBe(false);
    expect(CertificateInput.safeParse({ ...c, category: "shop" }).success).toBe(false);
    expect(CertificateInput.safeParse({ ...c, expiresOn: "next year" }).success).toBe(false);
    expect(CertificateInput.safeParse({ ...c, expiresOn: "2026-02-30" }).success).toBe(false);
  });
});
