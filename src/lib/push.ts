import "server-only";
import webpush from "web-push";
import { MESSAGES, makeT, parseLocale, type Locale, type MessageKey, type Params } from "@/i18n";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push (VAPID) — reaches phones even when the app is closed. Native apps will add FCM/APNs
 * behind the same `notify()` call. Missing keys = push silently off (dev without setup).
 */
let configured: boolean | null = null;
function ready(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  configured = Boolean(pub && priv);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:ops@example.com", pub as string, priv as string);
  return configured;
}

export interface Notice {
  title: MessageKey;
  body: MessageKey;
  params?: Params;
  /** Where tapping the notification opens. */
  url: string;
  /** Same tag replaces an earlier notification (e.g. one per task). */
  tag?: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
}

/** Sends to every device of these users, in each device's language. Returns how many were delivered. */
export async function notify(userIds: string[], n: Notice): Promise<number> {
  if (!ready() || userIds.length === 0) return 0;
  const db = createAdminClient();
  const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, locale").in("user_id", userIds).returns<SubRow[]>();
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    (data ?? []).map(async (s) => {
      const t = makeT(MESSAGES[parseLocale(s.locale)]);
      const payload = JSON.stringify({ title: t(n.title, n.params), body: t(n.body, n.params), url: n.url, tag: n.tag });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 120,
          urgency: "high",
        });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // unsubscribed / expired
        else console.error("push failed", code ?? e);
      }
    }),
  );
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  return sent;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(userId: string, sub: BrowserSubscription, locale: Locale): Promise<void> {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Bad push subscription");
  await createAdminClient()
    .from("push_subscriptions")
    .upsert({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, locale }, { onConflict: "endpoint" })
    .throwOnError();
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await createAdminClient().from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint).throwOnError();
}
