import { describe, expect, it } from "vitest";
import { CHAT_GRACE_MS, chatAccess, cleanMessage, maskContacts, mentionsOffAppPayment, type ChatDealView } from "@/lib/chat-rules";

const deal = (o: Partial<ChatDealView> = {}): ChatDealView => ({ status: "matched", customerId: "c", helperId: "h", endedAt: null, ...o });
const NOW = 1_800_000_000_000;

describe("chatAccess", () => {
  it("opens once a helper is chosen, for exactly the customer and that helper", () => {
    for (const status of ["awaiting_payment", "matched", "in_progress", "check", "disputed"] as const) {
      expect(chatAccess(deal({ status }), "c", NOW)).toMatchObject({ canRead: true, canSend: true, threadHelperId: "h", counterpartId: "h" });
      expect(chatAccess(deal({ status }), "h", NOW)).toMatchObject({ canRead: true, canSend: true, threadHelperId: "h", counterpartId: "c" });
      expect(chatAccess(deal({ status }), "stranger", NOW).canRead).toBe(false);
    }
  });

  it("before choosing: each applicant talks to the customer in their own conversation; nobody else can", () => {
    const open = deal({ status: "open", helperId: null, applicants: ["a1", "a2"] });
    expect(chatAccess(open, "a1", NOW)).toEqual({ canRead: true, canSend: true, threadHelperId: "a1", counterpartId: "c" });
    expect(chatAccess(open, "c", NOW, false, "a2")).toEqual({ canRead: true, canSend: true, threadHelperId: "a2", counterpartId: "a2" });
    expect(chatAccess(open, "c", NOW).canRead).toBe(false); // the customer must say which applicant
    expect(chatAccess(open, "c", NOW, false, "stranger").canRead).toBe(false); // not an applicant
    expect(chatAccess(open, "stranger", NOW).canRead).toBe(false);
    expect(chatAccess(deal({ status: "open", helperId: null }), "a1", NOW).canRead).toBe(false); // application lapsed
  });
  it("keeps pre-application questions private and lets the owner reply to an existing thread", () => {
    const open = deal({ status: "open", helperId: null, inquiryHelper: "h" });
    expect(chatAccess(open, "h", NOW)).toMatchObject({ canSend: true, threadHelperId: "h", counterpartId: "c", inquiry: true });
    expect(chatAccess(open, "c", NOW, false, "h").canSend).toBe(false);
    expect(chatAccess(open, "c", NOW, true, "h")).toMatchObject({ canSend: true, inquiry: true, counterpartId: "h" });
    expect(chatAccess(open, "h2", NOW, false, "h").canRead).toBe(false);
    expect(chatAccess(open, "c", NOW, false, "h2").canRead).toBe(false);
    const matched = { ...open, status: "matched" as const, helperId: "h2" };
    expect(chatAccess(matched, "h", NOW, true)).toMatchObject({ canRead: true, canSend: false });
    expect(chatAccess(matched, "c", NOW, true, "h")).toMatchObject({ canRead: true, canSend: false });
  });
  it("after choosing, the customer can still read (not write) another applicant's conversation", () => {
    const chosen = deal({ status: "matched", helperId: "a1" });
    expect(chatAccess(chosen, "c", NOW, true, "a2")).toMatchObject({ canRead: true, canSend: false, threadHelperId: "a2" });
    expect(chatAccess(chosen, "c", NOW, false, "a2")).toMatchObject({ canSend: true, threadHelperId: "a1" }); // nothing there → their chosen helper
  });

  it("a released helper keeps read-only access to their own conversation; the next helper gets a fresh one", () => {
    const reopened = deal({ status: "matched", helperId: "h2" });
    expect(chatAccess(reopened, "h1", NOW, true)).toMatchObject({ canRead: true, canSend: false, threadHelperId: "h1" });
    expect(chatAccess(reopened, "h2", NOW)).toMatchObject({ canSend: true, threadHelperId: "h2" });
    expect(chatAccess(reopened, "h1", NOW, false).canRead).toBe(false);
  });

  it("after the task ends: 24 h to send, then read-only", () => {
    const ended = deal({ status: "released", endedAt: NOW });
    expect(chatAccess(ended, "c", NOW + CHAT_GRACE_MS - 1).canSend).toBe(true);
    expect(chatAccess(ended, "c", NOW + CHAT_GRACE_MS)).toMatchObject({ canRead: true, canSend: false });
  });
});

describe("maskContacts", () => {
  const masked = (s: string) => maskContacts(s);

  it("hides Mongolian phone numbers in any common format", () => {
    for (const s of ["99112233", "9911 2233", "9911-2233", "+976 9911 2233", "976-99-11-22-33", "(976) 88001122"]) {
      const r = masked(`call me ${s} ok`);
      expect(r.masked, s).toBe(true);
      expect(r.text, s).not.toMatch(/\d{4}/);
    }
  });

  it("hides e-mails, links and messenger handles", () => {
    expect(masked("mail bat@gmail.com").masked).toBe(true);
    expect(masked("see https://example.com/x").masked).toBe(true);
    expect(masked("my page facebook.com/bat.erdene").masked).toBe(true);
    expect(masked("telegram @baterdene88").masked).toBe(true);
    expect(masked("fb: bat.erdene").masked).toBe(true);
  });

  it("keeps ordinary details: door codes, floors, prices, times", () => {
    for (const s of ["Орц 2, давхар 5, тоот 54", "код 1234#", "үнэ 18,500₮", "15:30-д ирнэ", "2 литр сүү", "нийт 1 250 000₮", "2026-11-14-нд", "20261114"]) {
      expect(masked(s), s).toEqual({ text: s, masked: false });
    }
  });
});

describe("cleanMessage", () => {
  it("trims, collapses blank lines, rejects empty or too long", () => {
    expect(cleanMessage("  hi\r\n\n\n\nthere  ")).toBe("hi\n\nthere");
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage("x".repeat(1001))).toBeNull();
  });
});

describe("mentionsOffAppPayment", () => {
  it.each([
    "Миний данс руу шилжүүлээрэй",
    "Дансаар явуулчих",
    "бэлэн мөнгөөр өгье",
    "Бэлнээр төлж болох уу?",
    "Шууд төлчих, апп-аас гадуур",
    "dansaar shiljuulchih",
    "Can you pay me directly in cash?",
    "Send it to my bank account",
  ])("flags %s", (text) => expect(mentionsOffAppPayment(text)).toBe(true));

  it.each([
    "Би бэлэн боллоо, 10 минутад очно",
    "Орцны код 1234, 5 давхар",
    "QPay-ээр апп дээр төлсөн",
    "Баярлалаа, маш сайн хийлээ",
    "I'm ready, on my way",
  ])("leaves %s alone", (text) => expect(mentionsOffAppPayment(text)).toBe(false));
});
