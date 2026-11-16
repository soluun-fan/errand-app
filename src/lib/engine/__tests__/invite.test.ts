import { describe, expect, it } from "vitest";
import { MINUTE_MS, invitedOnly, type ErrandDeal } from "../index";
import { World, customer, helper } from "./helpers";

const c1 = customer("c1");
const h1 = helper("h1");
const h2 = helper("h2");
const e = (w: World, id: string) => w.get(id) as ErrandDeal;

describe("direct requests (docs/decisions.md 2026-11-16 \"Direct requests\")", () => {
  it("only the invited helper may apply while the request stands; then everyone may", () => {
    const w = new World();
    const id = w.post({ invite: { helperId: "h1", openAfter: true } });
    expect(e(w, id).invite).toEqual({ helperId: "h1", openAfter: true, until: w.now + w.cfg.inviteMinutes * MINUTE_MS });
    expect(w.events.at(-1)).toMatchObject({ code: "invite_sent", data: { helperId: "h1", open: 1 } });
    expect(invitedOnly(e(w, id), w.now)).toBe("h1");

    w.reject(id, { type: "apply", note: "" }, h2, "FORBIDDEN");
    w.reject(id, { type: "accept" }, h2, "FORBIDDEN");
    w.advance(10 / 60);
    w.do(id, { type: "apply", note: "", price: 12000 }, h1); // the invited helper may also name a price
    w.advance((w.cfg.inviteMinutes - 10) / 60); // the request's time is up → opens by itself, no command needed
    expect(invitedOnly(e(w, id), w.now)).toBeNull();
    w.do(id, { type: "apply", note: "" }, h2);
    expect(e(w, id).offers.map((o) => o.helperId)).toEqual(["h1", "h2"]);
  });

  it("declining opens it to everyone (or ends it when the customer wanted only that helper)", () => {
    const w = new World();
    const open = w.post({ invite: { helperId: "h1", openAfter: true } });
    w.reject(open, { type: "decline_invite" }, h2, "FORBIDDEN"); // not h2's request
    w.do(open, { type: "decline_invite" }, h1);
    expect(e(w, open)).toMatchObject({ status: "open", invite: { until: w.now } });
    expect(w.events.at(-1)).toMatchObject({ code: "invite_declined", data: { open: 1 } });
    w.do(open, { type: "apply", note: "" }, h2);
    w.reject(open, { type: "decline_invite" }, h1, "FORBIDDEN"); // already open

    const only = w.post({ invite: { helperId: "h1", openAfter: false } });
    expect(e(w, only).invite?.until).toBe(e(w, only).matchBy); // exclusive for its whole life
    w.advance(0.25);
    w.reject(only, { type: "apply", note: "" }, h2, "FORBIDDEN"); // still only h1
    w.do(only, { type: "apply", note: "" }, h1);
    w.do(only, { type: "decline_invite" }, h1); // changed their mind: their offer goes too
    expect(e(w, only)).toMatchObject({ status: "expired", offers: [], heldAmount: 0 });
  });

  it("the customer can stop waiting and open it to everyone; doing it twice changes nothing", () => {
    const w = new World();
    const id = w.post({ invite: { helperId: "h1", openAfter: false } });
    w.reject(id, { type: "open_to_all" }, h1, "FORBIDDEN"); // only the customer
    w.do(id, { type: "open_to_all" }, c1);
    expect(e(w, id).invite).toMatchObject({ openAfter: true, until: w.now });
    expect(w.do(id, { type: "open_to_all" }, c1).duplicate).toBe(true);
    w.do(id, { type: "apply", note: "" }, h2);
  });

  it("the invited helper is chosen and paid like any other; an unanswered 'only them' request expires", () => {
    const w = new World();
    const id = w.post({ invite: { helperId: "h1", openAfter: false } });
    w.do(id, { type: "apply", note: "" }, h1);
    w.do(id, { type: "choose", helperId: "h1" }, c1);
    w.pay(id);
    expect(e(w, id)).toMatchObject({ status: "matched", helperId: "h1" });

    const lapsed = w.post({ invite: { helperId: "h2", openAfter: false } });
    w.advance(1);
    w.tick();
    expect(e(w, lapsed).status).toBe("expired");
  });

  it("a later start gives the helper longer to answer, never past the match deadline", () => {
    const w = new World();
    const at = w.now + 24 * 60 * MINUTE_MS;
    const id = w.post({ scheduledAt: at, invite: { helperId: "h1", openAfter: true } });
    expect(e(w, id).invite?.until).toBe(w.now + w.cfg.inviteMinutesScheduled * MINUTE_MS);
    const soon = w.post({ scheduledAt: w.now + 30 * MINUTE_MS, invite: { helperId: "h1", openAfter: true } });
    expect(e(w, soon).invite?.until).toBe(w.now + 30 * MINUTE_MS);
  });

  it("you can't send a request to yourself", () => {
    const w = new World();
    expect(() => w.post({ invite: { helperId: "c1", openAfter: true } })).toThrow(/yourself/);
  });
});
