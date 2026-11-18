import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertDealArgs } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { as, createTestDb, rpc, sqlError } from "./pg";

/** Public work photos (migration 20261118040000): reviews + helper portfolio, consent and limits. */
const customerId = "00000000-0000-4000-8000-000000000021";
const helperId = "00000000-0000-4000-8000-000000000022";
const strangerId = "00000000-0000-4000-8000-000000000023";
let db: PGlite;

const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));
const staging = (user: string) => `r/${user}/${crypto.randomUUID()}.jpg`;

/** A task in a given state with this helper (set directly; the engine's path is tested elsewhere). */
async function task(status: string, category = "shop"): Promise<string> {
  const t = createErrand(
    { id: crypto.randomUUID(), title: "Fix shelf", description: "x", category: "shop", mode: "now", address: "Test", customerId, fee: 10_000, itemBudget: 0 },
    { now: Date.now(), actor: { kind: "user", id: customerId, role: "customer" } },
  );
  await as(db, "service_role", null, (tx) => rpc(tx, "insert_deal", insertDealArgs(t)));
  await db.query("set session_replication_role = replica");
  await db.query("update public.deals set status = $2, helper_id = $3, category = $4 where id = $1", [t.deal.id, status, helperId, category]);
  await db.query("set session_replication_role = origin");
  return t.deal.id;
}

async function proof(dealId: string, kind: string, mime = "image/jpeg", by = helperId): Promise<string> {
  const r = await svc(`insert into public.proofs (deal_id, kind, mime, file_path, uploaded_by) values ($1, $2, $3, $4, $5) returning id`, [dealId, kind, mime, `${dealId}/${kind}-${crypto.randomUUID()}.jpg`, by]);
  return (r.rows[0] as { id: string }).id;
}

const review = (dealId: string, by = customerId) =>
  svc(`insert into public.work_photos (deal_id, helper_id, source, uploaded_by, staging_path, status) values ($1, $2, 'review', $3, $4, 'uploading') returning id`, [dealId, helperId, by, staging(by)]);
const ask = (dealId: string, proofId: string, by = helperId) =>
  svc(`insert into public.work_photos (deal_id, helper_id, source, uploaded_by, proof_id, status) values ($1, $2, 'helper', $3, $4, 'asked') returning id`, [dealId, helperId, by, proofId]);

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [customerId, helperId, strangerId]) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `97688100${id.slice(-2)}`]);
});
afterAll(async () => {
  await db?.close();
});

describe("storage and access", () => {
  it("public files sit in a JPEG-only public bucket; the tables are server-only", async () => {
    const b = await db.query<{ public: boolean; allowed_mime_types: string[] }>("select public, allowed_mime_types from storage.buckets where id = 'work-photos'");
    expect(b.rows[0]).toEqual({ public: true, allowed_mime_types: ["image/jpeg"] });
    for (const table of ["work_photos", "work_photo_reports"]) {
      for (const uid of [customerId, strangerId]) {
        const e = await sqlError(as(db, "authenticated", uid, (tx) => tx.query(`select * from public.${table}`)));
        expect(e.message).toMatch(/permission denied/);
      }
    }
  });
});

describe("review photos", () => {
  it("only the customer of a finished task, at most 3", async () => {
    const id = await task("released");
    const stranger = await sqlError(review(id, strangerId));
    expect(stranger.message).toMatch(/from the task's customer/);
    for (let i = 0; i < 3; i++) await review(id);
    const fourth = await sqlError(review(id));
    expect(fourth.message).toMatch(/at most 3 review photos/);
  });

  it("not before the task is finished, never for care work", async () => {
    const running = await task("in_progress");
    expect((await sqlError(review(running))).message).toMatch(/finished job/);
    const care = await task("released", "childcare");
    expect((await sqlError(review(care))).message).toMatch(/no public photos of care work/);
  });

  it("shown needs a public file; staging paths are checked", async () => {
    const id = await task("released");
    const r = await review(id);
    const pid = (r.rows[0] as { id: string }).id;
    const noFile = await sqlError(svc(`update public.work_photos set status = 'shown' where id = $1`, [pid]));
    expect(noFile.message).toMatch(/work_photos_shown_file/);
    const bad = await sqlError(svc(`insert into public.work_photos (deal_id, helper_id, source, uploaded_by, staging_path, status) values ($1, $2, 'review', $3, 'r/../../proofs/x.jpg', 'uploading')`, [id, helperId, customerId]));
    expect(bad.message).toMatch(/check constraint/);
    await svc(`update public.work_photos set status = 'shown', file_path = $2 where id = $1`, [pid, `${crypto.randomUUID()}.jpg`]);
  });
});

describe("portfolio photos", () => {
  it("only the helper's own JPEG handover / progress photos of that task", async () => {
    const id = await task("released");
    await ask(id, await proof(id, "handover"));
    await ask(id, await proof(id, "progress"));
    expect((await sqlError(ask(id, await proof(id, "start")))).message).toMatch(/your own photos of the work/);
    expect((await sqlError(ask(id, await proof(id, "receipt")))).message).toMatch(/your own photos of the work/);
    expect((await sqlError(ask(id, await proof(id, "handover", "video/mp4")))).message).toMatch(/your own photos of the work/);
    expect((await sqlError(ask(id, await proof(id, "handover", "image/jpeg", customerId)))).message).toMatch(/your own photos of the work/);
    expect((await sqlError(ask(id, await proof(id, "handover"), customerId))).message).toMatch(/from the task's helper/);
  });

  it("a photo the helper took back can't be shown; one request per photo; at most 4 per task", async () => {
    const id = await task("released");
    const gone = await proof(id, "handover");
    await svc(`update public.proofs set removed_at = now(), removed_by = $2 where id = $1`, [gone, helperId]);
    expect((await sqlError(ask(id, gone))).message).toMatch(/your own photos of the work/);
    const p1 = await proof(id, "handover");
    await ask(id, p1);
    expect((await sqlError(ask(id, p1))).message).toMatch(/duplicate key|unique/);
    for (let i = 0; i < 3; i++) await ask(id, await proof(id, "progress"));
    expect((await sqlError(ask(id, await proof(id, "progress")))).message).toMatch(/at most 4 portfolio photos/);
  });

  it("a photo from another task can't be borrowed", async () => {
    const a = await task("released");
    const b = await task("released");
    expect((await sqlError(ask(a, await proof(b, "handover")))).message).toMatch(/your own photos of the work/);
  });
});

describe("taking down", () => {
  it("removed, hidden or declined photos never come back; owner and origin are fixed", async () => {
    const id = await task("released");
    const r = await ask(id, await proof(id, "handover"));
    const pid = (r.rows[0] as { id: string }).id;
    const move = await sqlError(svc(`update public.work_photos set helper_id = $2 where id = $1`, [pid, strangerId]));
    expect(move.message).toMatch(/owner and origin are fixed/);
    await svc(`update public.work_photos set status = 'declined' where id = $1`, [pid]);
    const back = await sqlError(svc(`update public.work_photos set status = 'shown', file_path = $2 where id = $1`, [pid, `${crypto.randomUUID()}.jpg`]));
    expect(back.message).toMatch(/taken down/);
  });

  it("one report per person, with a known reason", async () => {
    const id = await task("released");
    const r = await review(id);
    const pid = (r.rows[0] as { id: string }).id;
    await svc(`insert into public.work_photo_reports (photo_id, reporter_id, reason) values ($1, $2, 'private')`, [pid, strangerId]);
    expect((await sqlError(svc(`insert into public.work_photo_reports (photo_id, reporter_id, reason) values ($1, $2, 'notWork')`, [pid, strangerId]))).message).toMatch(/duplicate key/);
    expect((await sqlError(svc(`insert into public.work_photo_reports (photo_id, reporter_id, reason) values ($1, $2, 'because')`, [pid, customerId]))).message).toMatch(/check constraint/);
  });
});
