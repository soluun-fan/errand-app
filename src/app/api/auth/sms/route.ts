import { recordError } from "@/lib/error-log";
import { sendOtpSms, verifyHookSignature } from "@/lib/sms";

/**
 * Supabase Auth → "Send SMS" hook (HTTP). Verifies the signature (SEND_SMS_HOOK_SECRET, the
 * "v1,whsec_…" secret Supabase shows), then sends the code through the SMS gateway (src/lib/sms.ts).
 * Answers {} on success or Supabase's error shape, so the login screen can say "try again".
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const ok = verifyHookSignature(
    process.env.SEND_SMS_HOOK_SECRET ?? "",
    { id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") },
    body,
  );
  if (!ok) return Response.json({ error: { http_code: 401, message: "bad signature" } }, { status: 401 });
  let phone = "";
  let otp = "";
  try {
    const event = JSON.parse(body) as { user?: { phone?: string }; sms?: { otp?: string } };
    phone = String(event.user?.phone ?? "");
    otp = String(event.sms?.otp ?? "");
  } catch {
    /* handled below */
  }
  if (!/^\d{8,15}$/.test(phone.replace(/^\+/, "")) || !/^\d{4,10}$/.test(otp)) {
    return Response.json({ error: { http_code: 400, message: "missing phone or otp" } }, { status: 400 });
  }
  // Mongolian mobile numbers only (+976 and 8 digits). Supabase's login API can be called directly,
  // skipping our form, so this is what stops bots making us pay for SMS abroad ("SMS pumping").
  if (!/^976\d{8}$/.test(phone.replace(/^\+/, ""))) {
    return Response.json({ error: { http_code: 400, message: "only Mongolian numbers can sign in" } }, { status: 400 });
  }
  try {
    await sendOtpSms(phone, otp);
    return Response.json({});
  } catch (e) {
    // never log the code itself; the phone's last digits are enough to find it
    await recordError({ source: "server", route: "/api/auth/sms", message: `SMS failed to …${phone.slice(-3)}: ${e instanceof Error ? e.message : String(e)}` });
    return Response.json({ error: { http_code: 502, message: "SMS could not be sent" } }, { status: 502 });
  }
}
