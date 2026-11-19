import { describe, expect, it } from "vitest";
import { as, createTestDb, sqlError } from "./pg";

describe("Verify.MN storage", () => {
  it("keeps verification records server-only and links recipient verifications to a task", async () => {
    const db = await createTestDb();
    const ownerId = "00000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users (id, phone) values ($1, $2)", [ownerId, "+97688000001"]);

    await as(db, "service_role", null, async (tx) => {
      await tx.query(
        `insert into public.verify_mn_sessions (provider_session_id, user_id, phone, sms_uri, display_instruction, expires_at)
         values ('session-1', $1, '+97688000001', 'sms:144773?body=482916', 'Send 482916 from this phone', now() + interval '5 minutes')`,
        [ownerId],
      );
    });

    const deniedSessionRead = await sqlError(as(db, "authenticated", ownerId, (tx) =>
      tx.query("select * from public.verify_mn_sessions"),
    ));
    expect(deniedSessionRead.code).toBe("42501");

    const deniedRecipientRead = await sqlError(as(db, "anon", null, (tx) =>
      tx.query("select * from public.recipient_verifications"),
    ));
    expect(deniedRecipientRead.code).toBe("42501");
    await db.close();
  });
});
