import "server-only";
import { type CategoryId, type Qualification } from "@/lib/engine";
import { qualificationsFrom, type MembershipFact, type OrgKind, type OrgStatus } from "@/lib/org-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/** The specialized kinds this helper may take right now, and through which organisation. */
export async function qualificationsFor(helperId: string, kycLevel: number, now = Date.now()): Promise<Qualification[]> {
  return (await qualificationsForMany([{ id: helperId, kycLevel }], now)).get(helperId) ?? [];
}

export async function qualificationsForMany(helpers: { id: string; kycLevel: number }[], now = Date.now()): Promise<Map<string, Qualification[]>> {
  if (!helpers.length) return new Map();
  const ids = helpers.map((h) => h.id);
  const db = createAdminClient();
  const [members, certs] = await Promise.all([
    db
      .from("org_members")
      .select("helper_id, org_id, status, categories, organizations!inner(status, categories, kind)")
      .in("helper_id", ids)
      .eq("status", "active")
      .returns<{ helper_id: string; org_id: string; status: MembershipFact["memberStatus"]; categories: CategoryId[]; organizations: { status: OrgStatus; categories: CategoryId[]; kind: OrgKind } }[]>(),
    db
      .from("helper_certificates")
      .select("helper_id, category, status, expires_on")
      .in("helper_id", ids)
      .eq("status", "approved")
      .returns<{ helper_id: string; category: CategoryId; status: "approved"; expires_on: string | null }[]>(),
  ]);
  if (members.error || certs.error) {
    console.error("qualifications failed", members.error?.message ?? certs.error?.message);
    return new Map(); // fail closed: no specialized work
  }
  return new Map(helpers.map((h) => [h.id, qualificationsFrom({
    kycLevel: h.kycLevel,
    now,
    memberships: (members.data ?? []).filter((m) => m.helper_id === h.id).map((m) => ({ orgId: m.org_id, orgStatus: m.organizations.status, orgKind: m.organizations.kind, orgCategories: m.organizations.categories ?? [], memberStatus: m.status, categories: m.categories ?? [] })),
    certificates: (certs.data ?? []).filter((c) => c.helper_id === h.id).map((c) => ({ category: c.category, status: c.status, expiresOn: c.expires_on })),
  })]));
}

