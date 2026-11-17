import "server-only";
import { cache } from "react";
import { DbError } from "@/lib/db/deals";
import { CATEGORIES, type CategoryId, type Trust } from "@/lib/engine";
import { helperDirectory, type HelperProfile } from "@/lib/helper-profile";
import { maskContacts } from "@/lib/chat-rules";
import { memberCategories, ubDay, type CertificateInput, type OrgApplicationInput, type OrgKind, type OrgStatus } from "@/lib/org-rules";
import { normalizeMnPhone } from "@/lib/phone";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Organisations, their workers, individual certificates and which kinds of task are switched on
 * (docs/decisions.md 2026-11-16 "Specialized work"). All tables are server-only; every function
 * here is called after the caller checked who the viewer is. The database refuses an unqualified
 * application or assignment on its own too (`private.can_take_via`).
 */
const BUCKET = "kyc"; // private; documents are read by Ops through short-lived links
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/* ---------- kinds of task: on / off ---------- */

export interface CategorySetting {
  category: CategoryId;
  trust: Trust;
  live: boolean;
}

/** Every kind with its trust level and whether customers can post it now. Once per request. */
export const categorySettings = cache(async (): Promise<CategorySetting[]> => {
  const { data, error } = await createAdminClient().from("category_settings").select("category, trust, live").returns<CategorySetting[]>();
  if (error) {
    console.error("category settings failed", error.message);
    // fail closed for specialized work: only the original kinds stay available
    return CATEGORIES.map((c) => ({ category: c.id, trust: c.trust, live: c.trust === "open" }));
  }
  const byId = new Map((data ?? []).map((r) => [r.category, r]));
  return CATEGORIES.map((c) => byId.get(c.id) ?? { category: c.id, trust: c.trust, live: false });
});

export async function liveCategories(): Promise<CategoryId[]> {
  return (await categorySettings()).filter((c) => c.live).map((c) => c.category);
}

/** Ops only (the caller checks). Logged. */
export async function setCategoryLive(opsId: string, category: CategoryId, live: boolean): Promise<void> {
  await createAdminClient()
    .from("category_settings")
    .update({ live, updated_at: new Date().toISOString(), updated_by: opsId })
    .eq("category", category)
    .throwOnError();
  await audit(opsId, live ? "category.on" : "category.off", category, { legalReviewed: live && CATEGORIES.find((c) => c.id === category)?.trust === "care" });
}

/* ---------- qualifications (for the engine actor) ---------- */

export { qualificationsFor } from "@/lib/qualifications";

/* ---------- documents (registration certificate, trade certificate) ---------- */

/** A one-time upload URL into the viewer's own folder of the private bucket. */
export async function createDocSlot(userId: string, kind: "org" | "cert", mime: string): Promise<{ path: string; token: string }> {
  const ext = EXT[mime];
  if (!ext) throw new Error("Unsupported file type");
  const path = `${userId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload URL");
  return { path, token: data.token };
}

async function ownFileExists(userId: string, path: string): Promise<boolean> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return false;
  const name = path.slice(userId.length + 1);
  const { data } = await createAdminClient().storage.from(BUCKET).list(userId, { search: name, limit: 1 });
  return Boolean(data?.some((f) => f.name === name));
}

const signedUrl = async (path: string | null) =>
  path ? ((await createAdminClient().storage.from(BUCKET).createSignedUrl(path, 300)).data?.signedUrl ?? null) : null;

/* ---------- organisations ---------- */

export interface Organization {
  id: string;
  name: string;
  regNumber: string;
  kind: OrgKind;
  description: string | null;
  area: string | null;
  ownerId: string;
  requestedCategories: CategoryId[];
  categories: CategoryId[];
  status: OrgStatus;
  reviewNote: string | null;
  createdAt: number;
}

interface OrgRow {
  id: string;
  name: string;
  reg_number: string;
  kind: OrgKind;
  description: string | null;
  area: string | null;
  owner_id: string;
  requested_categories: CategoryId[];
  categories: CategoryId[];
  status: OrgStatus;
  review_note: string | null;
  doc_path: string | null;
  created_at: string;
}
const toOrg = (r: OrgRow): Organization => ({
  id: r.id,
  name: r.name,
  regNumber: r.reg_number,
  kind: r.kind,
  description: r.description,
  area: r.area,
  ownerId: r.owner_id,
  requestedCategories: r.requested_categories ?? [],
  categories: r.categories ?? [],
  status: r.status,
  reviewNote: r.review_note,
  createdAt: Date.parse(r.created_at),
});

export type ApplyOrgResult = "ok" | "file" | "duplicate";

/** A signed-in person registers an organisation; Ops reviews it. Phones / links in the text are masked. */
export async function applyOrganization(ownerId: string, a: OrgApplicationInput): Promise<ApplyOrgResult> {
  if (!(await ownFileExists(ownerId, a.docPath))) return "file";
  const db = createAdminClient();
  const { data, error } = await db.rpc("register_organization", {
    p_org: {
      name: maskContacts(a.name).text,
      reg_number: a.regNumber,
      kind: a.kind,
      description: a.description ? maskContacts(a.description).text : null,
      area: a.area ? maskContacts(a.area).text : null,
      owner_id: ownerId,
      requested_categories: a.categories,
      doc_path: a.docPath,
    },
    p_payout: { bank: a.bank, account_number: a.accountNumber, holder_name: a.holderName },
  });
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new DbError(error ?? { message: "insert failed" });
  return "ok";
}

/** Organisations this person owns or manages (any status). */
export async function myOrganizations(userId: string): Promise<Organization[]> {
  const db = createAdminClient();
  const [owned, managed] = await Promise.all([
    db.from("organizations").select("*").eq("owner_id", userId).returns<OrgRow[]>(),
    db.from("org_members").select("org_id").eq("helper_id", userId).eq("status", "active").eq("role", "manager").returns<{ org_id: string }[]>(),
  ]);
  const ids = (managed.data ?? []).map((m) => m.org_id).filter((id) => !(owned.data ?? []).some((o) => o.id === id));
  const extra = ids.length ? ((await db.from("organizations").select("*").in("id", ids).returns<OrgRow[]>()).data ?? []) : [];
  return [...(owned.data ?? []), ...extra].map(toOrg);
}

export async function organization(id: string): Promise<Organization | null> {
  const { data } = await createAdminClient().from("organizations").select("*").eq("id", id).maybeSingle<OrgRow>();
  return data ? toOrg(data) : null;
}

/** May this person manage the organisation's workers? (owner, or an active manager) */
export async function canManage(orgId: string, userId: string): Promise<boolean> {
  const o = await organization(orgId);
  if (!o) return false;
  if (o.ownerId === userId) return true;
  const { count } = await createAdminClient()
    .from("org_members")
    .select("helper_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("helper_id", userId)
    .eq("status", "active")
    .eq("role", "manager");
  return (count ?? 0) > 0;
}

export interface PublicOrganization {
  org: Organization;
  workers: HelperProfile[];
  rating: number | null;
  ratingCount: number;
  jobsDone: number;
}

/** What customers see: approved organisations only, with their active workers and the ratings of jobs done through them. */
export async function publicOrganization(id: string): Promise<PublicOrganization | null> {
  const o = await organization(id);
  if (!o || o.status !== "approved") return null;
  const db = createAdminClient();
  const [members, jobs] = await Promise.all([
    db.from("org_members").select("helper_id").eq("org_id", id).eq("status", "active").returns<{ helper_id: string }[]>(),
    db.from("deals").select("id, helper_id").eq("payee_org_id", id).eq("status", "released").limit(1000).returns<{ id: string; helper_id: string }[]>(),
  ]);
  const ids = (members.data ?? []).map((m) => m.helper_id);
  const workers = ids.length ? await helperDirectory({ ids, limit: 100 }) : [];
  const dealIds = (jobs.data ?? []).map((j) => j.id);
  const helpersByDeal = new Map((jobs.data ?? []).map((j) => [j.id, j.helper_id]));
  const ratings = (dealIds.length ? ((await db.from("ratings").select("deal_id, to_user_id, stars").in("deal_id", dealIds).returns<{ deal_id: string; to_user_id: string; stars: number }[]>()).data ?? []) : [])
    .filter((r) => r.to_user_id === helpersByDeal.get(r.deal_id));
  const sum = ratings.reduce((a, r) => a + Number(r.stars), 0);
  return {
    org: o,
    workers,
    rating: ratings.length ? Math.round((sum / ratings.length) * 10) / 10 : null,
    ratingCount: ratings.length,
    jobsDone: dealIds.length,
  };
}

/** Approved organisations each helper works for (for "Х ХХК-ийн ажилтан" badges). */
export async function orgBadges(helperIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>();
  if (!helperIds.length) return out;
  const { data } = await createAdminClient()
    .from("org_members")
    .select("helper_id, organizations!inner(id, name, status)")
    .in("helper_id", helperIds)
    .eq("status", "active")
    .eq("organizations.status", "approved")
    .returns<{ helper_id: string; organizations: { id: string; name: string; status: string } }[]>();
  for (const r of data ?? []) out.set(r.helper_id, [...(out.get(r.helper_id) ?? []), { id: r.organizations.id, name: r.organizations.name }]);
  return out;
}

/* ---------- workers ---------- */

export interface Member {
  helperId: string;
  name: string;
  role: "owner" | "manager" | "worker";
  categories: CategoryId[];
  status: "invited" | "active" | "declined" | "removed";
  kycLevel: number;
}

export async function members(orgId: string): Promise<Member[]> {
  const { data } = await createAdminClient()
    .from("org_members")
    .select("helper_id, role, categories, status, profiles!org_members_helper_id_fkey(name, kyc_level)")
    .eq("org_id", orgId)
    .in("status", ["invited", "active"])
    .order("created_at")
    .returns<{ helper_id: string; role: Member["role"]; categories: CategoryId[]; status: Member["status"]; profiles: { name: string | null; kyc_level: number } }[]>();
  return (data ?? []).map((m) => ({ helperId: m.helper_id, name: m.profiles?.name?.trim() || "—", role: m.role, categories: m.categories ?? [], status: m.status, kycLevel: Number(m.profiles?.kyc_level ?? 0) }));
}

export type InviteResult = "ok" | "notFound" | "notHelper" | "notApproved" | "noKinds" | "self";

/**
 * The organisation adds a worker by their phone number (it knows its own staff); the worker must
 * already be a verified helper and accept. Care kinds also need their criminal-record check — the
 * invite is allowed, but they can't take care work until Ops has seen that certificate.
 */
export async function inviteMember(orgId: string, byUserId: string, phone: string, requested: string[], role: "worker" | "manager"): Promise<InviteResult> {
  const o = await organization(orgId);
  if (!o || o.status !== "approved") return "notApproved";
  const kinds = memberCategories(requested, o.categories);
  if (!kinds.length && role === "worker") return "noKinds";
  const e164 = normalizeMnPhone(phone);
  if (!e164) return "notFound";
  const db = createAdminClient();
  const { data: p } = await db.from("profiles").select("id, role, helper_status").eq("phone", e164.slice(1)).maybeSingle<{ id: string; role: string; helper_status: string | null }>();
  if (!p) return "notFound";
  if (p.id === o.ownerId) return "self";
  if (role === "worker" && (p.role !== "helper" || p.helper_status !== "approved")) return "notHelper";
  await db
    .from("org_members")
    .upsert({ org_id: orgId, helper_id: p.id, role, categories: kinds, status: "invited", invited_by: byUserId, created_at: new Date().toISOString(), decided_at: null }, { onConflict: "org_id,helper_id" })
    .throwOnError();
  await audit(byUserId, "org.invite", orgId, { helperId: p.id, kinds, role });
  return "ok";
}

export async function removeMember(orgId: string, byUserId: string, helperId: string): Promise<void> {
  await createAdminClient().from("org_members").update({ status: "removed", decided_at: new Date().toISOString() }).eq("org_id", orgId).eq("helper_id", helperId).neq("role", "owner").throwOnError();
  await audit(byUserId, "org.remove", orgId, { helperId });
}

export interface Invitation {
  orgId: string;
  orgName: string;
  role: Member["role"];
  categories: CategoryId[];
}

/** Invitations waiting for this person's answer (approved organisations only). */
export async function myInvitations(userId: string): Promise<Invitation[]> {
  const { data } = await createAdminClient()
    .from("org_members")
    .select("org_id, role, categories, organizations!inner(name, status)")
    .eq("helper_id", userId)
    .eq("status", "invited")
    .eq("organizations.status", "approved")
    .returns<{ org_id: string; role: Member["role"]; categories: CategoryId[]; organizations: { name: string; status: string } }[]>();
  return (data ?? []).map((r) => ({ orgId: r.org_id, orgName: r.organizations.name, role: r.role, categories: r.categories ?? [] }));
}

/** Organisations this helper works for (active), for their own profile. */
export async function myMemberships(userId: string): Promise<Invitation[]> {
  const { data } = await createAdminClient()
    .from("org_members")
    .select("org_id, role, categories, organizations!inner(name, status)")
    .eq("helper_id", userId)
    .eq("status", "active")
    .returns<{ org_id: string; role: Member["role"]; categories: CategoryId[]; organizations: { name: string; status: string } }[]>();
  return (data ?? []).map((r) => ({ orgId: r.org_id, orgName: r.organizations.name, role: r.role, categories: r.categories ?? [] }));
}

export async function answerInvitation(userId: string, orgId: string, accept: boolean): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("org_members")
    .update({ status: accept ? "active" : "declined", decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("helper_id", userId)
    .eq("status", "invited")
    .select("org_id");
  return Boolean(data?.length);
}

/** A worker leaves an organisation. */
export async function leaveOrganization(userId: string, orgId: string): Promise<void> {
  await createAdminClient().from("org_members").update({ status: "removed", decided_at: new Date().toISOString() }).eq("org_id", orgId).eq("helper_id", userId).neq("role", "owner").throwOnError();
}

/* ---------- Ops: organisations ---------- */

export interface OrgForOps extends Organization {
  docUrl: string | null;
  ownerName: string;
  payout: { bank: string; last4: string; holder: string } | null;
}

export async function orgQueue(): Promise<Organization[]> {
  const { data } = await createAdminClient().from("organizations").select("*").order("created_at").returns<OrgRow[]>();
  return (data ?? []).map(toOrg).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
}

export async function orgForOps(id: string): Promise<OrgForOps | null> {
  const db = createAdminClient();
  const { data } = await db.from("organizations").select("*").eq("id", id).maybeSingle<OrgRow>();
  if (!data) return null;
  const [owner, payout] = await Promise.all([
    db.from("profiles").select("name").eq("id", data.owner_id).maybeSingle<{ name: string | null }>(),
    db.from("organization_payout_accounts").select("bank, account_number, holder_name").eq("org_id", id).maybeSingle<{ bank: string; account_number: string; holder_name: string }>(),
  ]);
  return {
    ...toOrg(data),
    docUrl: await signedUrl(data.doc_path),
    ownerName: owner.data?.name?.trim() || "—",
    payout: payout.data ? { bank: payout.data.bank, last4: payout.data.account_number.slice(-4), holder: payout.data.holder_name } : null,
  };
}

/** Approve (for some of the kinds it asked for), reject, or suspend. The owner becomes an active "owner" member on approval. */
export async function decideOrganization(opsId: string, id: string, status: "approved" | "rejected" | "suspended", categories: CategoryId[], note: string | null): Promise<boolean> {
  const o = await organization(id);
  if (!o) return false;
  const kinds = status === "approved" ? memberCategories(categories, o.requestedCategories) : o.categories;
  if (status === "approved" && (!kinds.length || (o.kind !== "agency" && kinds.some((c) => c === "childcare" || c === "eldercare")))) return false;
  if (status === "approved") {
    const review = await orgForOps(id);
    if (!review?.docUrl || !review.payout) return false;
  }
  const db = createAdminClient();
  await db
    .from("organizations")
    .update({ status, categories: kinds, review_note: note, reviewed_by: opsId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .throwOnError();
  if (status === "approved") {
    await db
      .from("org_members")
      .upsert({ org_id: id, helper_id: o.ownerId, role: "owner", categories: kinds, status: "active", invited_by: opsId, decided_at: new Date().toISOString() }, { onConflict: "org_id,helper_id" })
      .throwOnError();
  }
  await audit(opsId, `org.${status}`, id, { kinds, note });
  return true;
}

/* ---------- certificates ---------- */

export interface Certificate {
  id: string;
  helperId: string;
  category: CategoryId;
  issuer: string;
  number: string | null;
  expiresOn: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  reviewNote: string | null;
  createdAt: number;
}
interface CertRow {
  id: string;
  helper_id: string;
  category: CategoryId;
  issuer: string;
  number: string | null;
  expires_on: string | null;
  status: Certificate["status"];
  review_note: string | null;
  doc_path: string;
  created_at: string;
}
const toCert = (r: CertRow): Certificate => ({ id: r.id, helperId: r.helper_id, category: r.category, issuer: r.issuer, number: r.number, expiresOn: r.expires_on, status: r.status, reviewNote: r.review_note, createdAt: Date.parse(r.created_at) });

export async function myCertificates(helperId: string): Promise<Certificate[]> {
  const { data } = await createAdminClient().from("helper_certificates").select("*").eq("helper_id", helperId).order("created_at", { ascending: false }).returns<CertRow[]>();
  return (data ?? []).map((r) => toCert({ ...r, status: r.status === "approved" && r.expires_on && r.expires_on < ubDay(Date.now()) ? "expired" : r.status }));
}

export async function submitCertificate(helperId: string, c: CertificateInput): Promise<"ok" | "file" | "duplicate" | "needsRecord"> {
  if (!(await ownFileExists(helperId, c.docPath))) return "file";
  const db = createAdminClient();
  // Expiry is date based; clear the unique active slot before accepting a renewal.
  await db.from("helper_certificates").update({ status: "expired" }).eq("helper_id", helperId).eq("category", c.category).in("status", ["pending", "approved"]).lt("expires_on", ubDay(Date.now())).throwOnError();
  const { error } = await db
    .from("helper_certificates")
    .insert({ helper_id: helperId, category: c.category, issuer: c.issuer, number: c.number, expires_on: c.expiresOn, doc_path: c.docPath });
  if (error?.code === "23505") return "duplicate"; // one pending / approved per kind
  if (error?.code === "23514" && /criminal-record/.test(error.message)) return "needsRecord"; // care clearance
  if (error) throw new DbError(error);
  return "ok";
}

export async function certificateQueue(): Promise<(Certificate & { helperName: string; docUrl: string | null })[]> {
  const db = createAdminClient();
  const { data } = await db.from("helper_certificates").select("*").eq("status", "pending").order("created_at").limit(50).returns<CertRow[]>();
  const rows = data ?? [];
  const names = rows.length ? ((await db.from("profiles").select("id, name").in("id", rows.map((r) => r.helper_id)).returns<{ id: string; name: string | null }[]>()).data ?? []) : [];
  return Promise.all(rows.map(async (r) => ({ ...toCert(r), helperName: names.find((n) => n.id === r.helper_id)?.name?.trim() || "—", docUrl: await signedUrl(r.doc_path) })));
}

export async function decideCertificate(opsId: string, id: string, approve: boolean, note: string | null): Promise<boolean> {
  if (approve) {
    const { data } = await createAdminClient().from("helper_certificates").select("doc_path, expires_on").eq("id", id).maybeSingle<{ doc_path: string; expires_on: string | null }>();
    if (!data || (data.expires_on && data.expires_on < ubDay(Date.now())) || !(await signedUrl(data.doc_path))) return false;
  }
  const { data } = await createAdminClient()
    .from("helper_certificates")
    .update({ status: approve ? "approved" : "rejected", review_note: note, reviewed_by: opsId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (data?.length) await audit(opsId, approve ? "certificate.approve" : "certificate.reject", id, { note });
  return Boolean(data?.length);
}

/** Names only for the organisation snapshotted on a job or offer, even after suspension. */
export async function organizationNames(ids: (string | null)[]): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data, error } = await createAdminClient().from("organizations").select("id, name").in("id", unique).returns<{ id: string; name: string }[]>();
  if (error) throw new DbError(error);
  return new Map((data ?? []).map((o) => [o.id, o]));
}

/** Caller must have checked canManage; reflects the same payable ledger as individual earnings. */
export async function organizationBalance(orgId: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc("account_balance", { p_account: `payable:${orgId}` });
  if (error) throw new DbError(error);
  return Number(data ?? 0);
}
