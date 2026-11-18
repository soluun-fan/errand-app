import { z } from "zod";
import { LANGUAGES } from "@/lib/engine/types";
import { CATEGORIES, type ErrandDetails } from "@/lib/engine";

/**
 * Shapes of everything a phone can send us (docs/rules.md "Input validation"). Server actions are
 * public HTTP endpoints: their TypeScript types are not checked at runtime, so every action that
 * takes data parses it here first. Bad input → a calm error or nothing happens; never a crash.
 * Business rules (prices, limits, who may do what) stay in the engine / lib — this is only shape.
 */

/** Parse or null — callers turn null into their own friendly error. */
export function parseOr<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

/** Yes/no — for values where null is itself valid (so `parseOr` can't tell). */
export function isValid(schema: z.ZodTypeAny, value: unknown): boolean {
  return schema.safeParse(value).success;
}

export const Uuid = z.string().uuid();

export const LatLng = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/** A map pin sent as JSON text from a hidden form field (`{"lat":..,"lng":..}`); empty = none. */
export const PinJson = z
  .string()
  .max(200)
  .transform((s, ctx) => {
    if (s === "") return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "bad json" });
      return z.NEVER;
    }
  })
  .pipe(LatLng.nullable());

/** Task photo ids from the post form (a JSON array, at most 5). */
export const PhotoIdsJson = z
  .string()
  .max(500)
  .transform((s, ctx) => {
    try {
      return JSON.parse(s || "[]") as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "bad json" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().uuid()).max(5));

const text = (max: number) => z.string().max(max).nullable();

/** The post form's task details (types only; the engine checks ranges and prices). */
export const DetailsInput = z
  .object({
    km: z.number().finite(),
    entrance: text(40),
    floor: z.number().int().nullable(),
    unit: text(40),
    lift: z.enum(["yes", "no", "unknown"]).nullable(),
    note: text(600),
    people: z.union([z.literal(1), z.literal(2)]),
    carryByHelper: z.boolean(),
    heavy: z.boolean(),
    roundTrip: z.boolean(),
    budgetBuffer: z.boolean(),
    autoPick: z.boolean(),
    minutes: z.number().int(),
    tools: z.boolean(),
    // the customer's conditions for the helper (docs/decisions.md 2026-11-18 "Task conditions")
    require: z
      .object({
        driver: z.boolean(),
        car: z.boolean(),
        checked: z.boolean(),
        onTime: z.boolean(),
        call: z.boolean(),
        handoverCode: z.boolean(),
        language: z.enum(LANGUAGES).nullable(),
      })
      .partial()
      .strip(),
  })
  .partial()
  // quotedFee / counterMax are set by the engine; anything the client adds is dropped
  .strip() satisfies z.ZodType<Partial<ErrandDetails>>;

export const DetailsJson = z
  .string()
  .max(4000)
  .transform((s, ctx) => {
    try {
      return JSON.parse(s || "{}") as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "bad json" });
      return z.NEVER;
    }
  })
  .pipe(DetailsInput);

export const CategoryInput = z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]);

export const ProofKindInput = z.enum(["receipt", "handover", "start", "progress"]);

export const ProofSubmitInput = z.object({
  dealId: Uuid,
  kind: ProofKindInput,
  path: z.string().min(1).max(300),
  mime: z.string().max(100),
  bytes: z.number().int().positive(),
  sha256: z.string().nullable(),
  dhash: z.string().nullable(),
  amount: z.number().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  takenAt: z.number().nullable(),
  note: z.string().max(140).nullable().optional(),
});

export const PushSubscriptionInput = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const CallEndKind = z.enum(["hangup", "decline", "busy"]);

export const CallLogInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["missed", "declined", "failed"]), video: z.boolean() }),
  z.object({ kind: z.literal("ended"), video: z.boolean(), seconds: z.number().finite().min(0).max(86_400) }),
]);

/** Paths of files the browser already uploaded (checked against storage by the caller). */
export const UploadPath = z.string().min(1).max(300);

export const KycFormInput = z.object({
  legalName: z.string().max(200),
  birthDate: z.string().max(20),
  idLast4: z.string().max(10),
  categories: z.array(z.string().max(20)).max(10),
  files: z.record(z.string(), UploadPath),
  bank: z.string().max(50),
  accountNumber: z.string().max(40),
  holderName: z.string().max(200),
  consent: z.boolean(),
  /** accepted the Helper service agreement (docs/decisions.md 2026-11-18 "Registration and terms") */
  agreement: z.boolean(),
});
