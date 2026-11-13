import { expect } from "vitest";
import {
  CATEGORIES,
  EngineError,
  HOUR_MS,
  amountDue,
  apply,
  balanceOf,
  checkInvariants,
  createErrand,
  createGoods,
  runDue,
  type Account,
  type Actor,
  type Command,
  type Deal,
  type Effect,
  type EngineErrorCode,
  type LedgerEntry,
  type NewErrandInput,
  type NewGoodsInput,
  type TimelineEvent,
  type Transition,
  type UserActor,
} from "../index";

export const T0 = Date.UTC(2026, 10, 12, 8, 0, 0);
const ALL_CATS = CATEGORIES.map((c) => c.id);

export const customer = (id = "c1"): UserActor => ({ kind: "user", id, role: "customer" });
export const helper = (id = "h1", opts: Partial<UserActor> = {}): UserActor => ({
  kind: "user",
  id,
  role: "helper",
  helperApproved: true,
  categories: ALL_CATS,
  ...opts,
});
export const admin = (id = "ops"): UserActor => ({ kind: "user", id, role: "admin" });
export const provider: Actor = { kind: "provider" };
export const system: Actor = { kind: "system" };

/** In-memory stand-in for the DB: applies transitions and checks invariants after every step. */
export class World {
  now = T0;
  deals = new Map<string, Deal>();
  ledger: LedgerEntry[] = [];
  events: TimelineEvent[] = [];
  effects: Effect[] = [];
  private seq = 0;

  private record<D extends Deal>(t: Transition<D>): Transition<D> {
    this.deals.set(t.deal.id, t.deal);
    this.ledger.push(...t.ledger);
    this.events.push(...t.events);
    this.effects.push(...t.effects);
    this.check();
    return t;
  }

  check(): void {
    expect(checkInvariants([...this.deals.values()], this.ledger)).toEqual([]);
  }

  get(id: string): Deal {
    const d = this.deals.get(id);
    if (!d) throw new Error(`no deal ${id}`);
    return d;
  }

  post(input: Partial<NewErrandInput> = {}, by = customer(input.customerId ?? "c1")): string {
    const id = input.id ?? `E${++this.seq}`;
    this.record(
      createErrand(
        {
          id,
          title: "Groceries from Nomin",
          description: "Milk, bread, eggs",
          category: "shop",
          mode: "now",
          address: "8th khoroo, Bldg 45",
          itemBudget: 0,
          fee: 10000,
          customerId: by.id,
          ...input,
        },
        { now: this.now, actor: by },
      ),
    );
    return id;
  }

  sell(input: Partial<NewGoodsInput> = {}, by = customer(input.sellerId ?? "c1")): string {
    const id = input.id ?? `S${++this.seq}`;
    this.record(
      createGoods(
        { id, title: "iPhone 13", price: 1_350_000, checkHours: 24, sellerId: by.id, code: "7K2Q9F", ...input },
        { now: this.now, actor: by },
      ),
    );
    return id;
  }

  do(id: string, cmd: Command, actor: Actor): Transition {
    return this.record(apply(this.get(id), cmd, { now: this.now, actor }));
  }

  /** Expect the command to be rejected with the given error code, and nothing to change. */
  reject(id: string, cmd: Command, actor: Actor, code?: EngineErrorCode): EngineError {
    const before = structuredClone(this.get(id));
    let err: unknown;
    try {
      apply(this.get(id), cmd, { now: this.now, actor });
    } catch (e) {
      err = e;
    }
    expect(err, `${cmd.type} should have been rejected`).toBeInstanceOf(EngineError);
    if (code) expect((err as EngineError).code).toBe(code);
    expect(this.get(id)).toEqual(before);
    return err as EngineError;
  }

  pay(id: string, ref = `qpay-${id}`): Transition {
    return this.do(id, { type: "confirm_payment", providerRef: ref, amount: amountDue(this.get(id)) }, provider);
  }

  advance(hours: number): void {
    this.now += hours * HOUR_MS;
  }

  /** Runs the background job over every deal. Returns how many deals changed. */
  tick(): number {
    let n = 0;
    for (const d of [...this.deals.values()]) {
      const t = runDue(d, this.now);
      if (t) {
        this.record(t);
        n++;
      }
    }
    return n;
  }

  bal(account: Account, dealId?: string): number {
    return balanceOf(this.ledger, account, dealId);
  }

  codes(id: string): string[] {
    return this.events.filter((e) => e.dealId === id).map((e) => e.code);
  }
}
