/**
 * Table-driven: from every reachable status, every command NOT in the allowed set must be
 * rejected and leave the deal untouched. Commands run far in the future so time-based
 * guards (expiry, auto-release) never hide an illegal status.
 */
import { describe, expect, it } from "vitest";
import { EngineError, HOUR_MS, amountDue, apply, type Actor, type Command, type CommandType, type Deal } from "../index";
import { World, admin, customer, helper, provider, system } from "./helpers";

type Step = (w: World, id: string) => void;
const FAR = 10_000 * HOUR_MS;

function commandsFor(deal: Deal, actors: { payer: Actor; worker: Actor; other: Actor }) {
  const list: [Command, Actor][] = [
    [{ type: "confirm_payment", providerRef: "fresh-ref", amount: amountDue(deal) }, provider],
    [{ type: "claim" }, customer("c9")],
    [{ type: "accept" }, helper("h2")],
    [{ type: "apply", note: "" }, helper("h2")],
    [{ type: "choose", helperId: "h2" }, actors.payer],
    [{ type: "cancel" }, actors.other],
    [{ type: "expire" }, system],
    [{ type: "start" }, actors.worker],
    [{ type: "record_receipt", amount: 1000 }, actors.worker],
    [{ type: "record_handover" }, actors.worker],
    [{ type: "finish" }, actors.worker],
    [{ type: "handover" }, actors.other],
    [{ type: "confirm" }, actors.payer],
    [{ type: "dispute", reason: "x" }, actors.payer],
    [{ type: "resolve", outcome: "release" }, admin()],
    [{ type: "auto_release" }, system],
  ];
  return list;
}

function checkTable(
  name: string,
  make: (w: World) => string,
  reach: Record<string, Step[]>,
  allowed: Record<string, CommandType[]>,
  actors: { payer: Actor; worker: Actor; other: Actor },
) {
  describe(name, () => {
    for (const [status, steps] of Object.entries(reach)) {
      it(`from "${status}" rejects everything except ${JSON.stringify(allowed[status])}`, () => {
        const w = new World();
        const id = make(w);
        for (const s of steps) s(w, id);
        const deal = w.get(id);
        expect(deal.status).toBe(status);
        const snapshot = structuredClone(deal);
        for (const [cmd, actor] of commandsFor(deal, actors)) {
          if (allowed[status].includes(cmd.type)) continue;
          let err: unknown;
          try {
            apply(deal, cmd, { now: w.now + FAR, actor });
          } catch (e) {
            err = e;
          }
          expect(err, `${status} + ${cmd.type} should be rejected`).toBeInstanceOf(EngineError);
          expect(["ILLEGAL_TRANSITION", "FORBIDDEN"]).toContain((err as EngineError).code);
          expect(deal).toEqual(snapshot);
        }
      });
    }
  });
}

/* ---------- errands (Now mode, with an item budget) ---------- */

const c1 = customer("c1");
const h1 = helper("h1");
const pay: Step = (w, id) => void w.pay(id);
const accept: Step = (w, id) => void w.do(id, { type: "accept" }, h1);
const start: Step = (w, id) => void w.do(id, { type: "start" }, h1);
const proofAndFinish: Step = (w, id) => {
  w.do(id, { type: "record_receipt", amount: 9000 }, h1);
  w.do(id, { type: "record_handover" }, h1);
  w.do(id, { type: "finish" }, h1);
};
const dispute: Step = (w, id) => void w.do(id, { type: "dispute", reason: "x" }, c1);

checkTable(
  "errand transitions",
  (w) => w.post({ itemBudget: 10000 }),
  {
    awaiting_payment: [],
    open: [pay],
    matched: [pay, accept],
    in_progress: [pay, accept, start],
    check: [pay, accept, start, proofAndFinish],
    disputed: [pay, accept, start, proofAndFinish, dispute],
    released: [pay, accept, start, proofAndFinish, (w, id) => void w.do(id, { type: "confirm" }, c1)],
    refunded: [pay, accept, start, proofAndFinish, dispute, (w, id) => void w.do(id, { type: "resolve", outcome: "refund" }, admin())],
    cancelled: [pay, (w, id) => void w.do(id, { type: "cancel" }, c1)],
    expired: [pay, (w) => w.advance(1), (w) => void w.tick()],
  },
  {
    awaiting_payment: ["confirm_payment", "cancel", "expire"],
    open: ["accept", "cancel", "expire"],
    matched: ["cancel", "start"],
    in_progress: ["record_receipt", "record_handover", "finish"],
    check: ["confirm", "dispute", "auto_release"],
    disputed: ["resolve"],
    released: [],
    refunded: [],
    cancelled: [],
    expired: [],
  },
  { payer: c1, worker: h1, other: c1 },
);

/* ---------- goods ---------- */

const seller = customer("c1");
const buyer = customer("c2");
const claim: Step = (w, id) => void w.do(id, { type: "claim" }, buyer);
const handover: Step = (w, id) => void w.do(id, { type: "handover" }, seller);
const gDispute: Step = (w, id) => void w.do(id, { type: "dispute", reason: "x" }, buyer);

checkTable(
  "goods transitions",
  (w) => w.sell({ price: 100000 }),
  {
    awaiting_payment: [claim],
    held: [claim, pay],
    check: [claim, pay, handover],
    disputed: [claim, pay, handover, gDispute],
    released: [claim, pay, handover, (w, id) => void w.do(id, { type: "confirm" }, buyer)],
    refunded: [claim, pay, handover, gDispute, (w, id) => void w.do(id, { type: "resolve", outcome: "refund" }, admin())],
    cancelled: [claim, pay, (w, id) => void w.do(id, { type: "cancel" }, seller)],
  },
  {
    awaiting_payment: ["confirm_payment", "cancel"],
    held: ["cancel", "handover"],
    check: ["confirm", "dispute", "auto_release"],
    disputed: ["resolve"],
    released: [],
    refunded: [],
    cancelled: [],
  },
  { payer: buyer, worker: helper("h1"), other: seller },
);
