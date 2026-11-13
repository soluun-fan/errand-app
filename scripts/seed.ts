/**
 * Demo data, created through the same code path as the app (engine → repository → RPC).
 * Safe to run more than once: users are upserted, demo deals only created on an empty DB.
 *
 *   npm run seed            (reads .env.local)
 *
 * Phone numbers must match [auth.sms.test_otp] in supabase/config.toml (login code 123456).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { insertDeal, runCommand } from "../src/lib/db/deals";
import { amountDue, createErrand, type CategoryId, type UserActor } from "../src/lib/engine";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}
const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ALL: CategoryId[] = ["shop", "carry", "queue", "deliver", "repair", "other"];

interface DemoUser {
  key: string;
  phone: string; // without "+", as stored by Supabase Auth
  profile: Record<string, unknown> & { name: string; role: "customer" | "helper" | "admin" };
}

const USERS: DemoUser[] = [
  { key: "solongo", phone: "97688000001", profile: { name: "Solongo B.", role: "customer", area: "8th khoroo", kyc_level: 1 } },
  {
    key: "tsogt",
    phone: "97688000002",
    profile: { name: "Tsogt G.", role: "customer", area: "3rd khoroo", kyc_level: 2, verified_name: "Tsogt G." },
  },
  {
    key: "bat",
    phone: "97688000011",
    profile: {
      name: "Bat-Erdene G.", role: "helper", helper_status: "approved", kyc_level: 3, verified_name: "Bat-Erdene G.",
      categories: ALL, rating_sum: 627, rating_count: 128, completed_count: 128,
      payout_bank: "M Bank", payout_account_last4: "4417", payout_holder_name: "Bat-Erdene G.",
    },
  },
  {
    key: "nomin",
    phone: "97688000012",
    profile: {
      name: "Nomin A.", role: "helper", helper_status: "approved", kyc_level: 3, verified_name: "Nomin A.",
      categories: ["shop", "queue", "deliver", "carry"], rating_sum: 293, rating_count: 61, completed_count: 61,
      payout_bank: "Khan Bank", payout_account_last4: "2290", payout_holder_name: "Nomin A.",
    },
  },
  {
    key: "temuulen",
    phone: "97688000013",
    profile: {
      name: "Temuulen M.", role: "helper", helper_status: "pending", kyc_level: 3, verified_name: "Temuulen M.",
      categories: ["carry", "repair"], payout_bank: "Golomt", payout_account_last4: "0815", payout_holder_name: "Temuulen M.",
    },
  },
  { key: "ops", phone: "97688000099", profile: { name: "Ops team", role: "admin", kyc_level: 2 } },
];

async function upsertUser(u: DemoUser): Promise<string> {
  // listUsers is paginated; a demo project is small, but walk pages anyway.
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((x) => x.phone === u.phone);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await db.auth.admin.createUser({
    phone: u.phone,
    phone_confirm: true,
    user_metadata: { name: u.profile.name },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    ids[u.key] = await upsertUser(u);
    const { error } = await db.from("profiles").update(u.profile).eq("id", ids[u.key]);
    if (error) throw error;
    console.log(`user  ${u.profile.name.padEnd(14)} +${u.phone}  ${u.profile.role}`);
  }

  const { count, error } = await db.from("deals").select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) {
    console.log(`deals: ${count} already exist, not adding demo deals`);
    return;
  }

  // Same scenario as the prototype: Tsogt's scheduled carry job, paid and held, Nomin applied.
  const now = Date.now();
  const tsogt: UserActor = { kind: "user", id: ids.tsogt, role: "customer" };
  const nomin: UserActor = {
    kind: "user", id: ids.nomin, role: "helper", helperApproved: true, categories: ["shop", "queue", "deliver", "carry"],
  };
  const tomorrow15 = new Date(now + 86_400_000);
  tomorrow15.setUTCHours(7, 0, 0, 0); // 15:00 Ulaanbaatar (UTC+8)

  const created = createErrand(
    {
      id: crypto.randomUUID(),
      title: "Carry a washing machine to 5th floor",
      description: "No elevator. 2 people needed. Bldg 12, entrance 2.",
      category: "carry",
      mode: "schedule",
      scheduledAt: tomorrow15.getTime(),
      address: "3rd khoroo, Bldg 12",
      itemBudget: 0,
      fee: 40000,
      customerId: ids.tsogt,
    },
    { now, actor: tsogt },
  );
  await insertDeal(db, created);
  const id = created.deal.id;
  // MockProvider stand-in: the bank confirms the pay-in.
  await runCommand(db, id, { type: "confirm_payment", providerRef: `seed-${id}`, amount: amountDue(created.deal) }, { kind: "provider" });
  await runCommand(db, id, { type: "apply", note: "I can come with my brother." }, nomin);
  console.log(`deal  "${created.deal.title}" — ₮${amountDue(created.deal).toLocaleString("en-US")} held, 1 applicant`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
