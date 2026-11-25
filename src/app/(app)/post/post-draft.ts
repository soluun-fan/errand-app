import type { Pin } from "@/components/pin-map";
import type { AddressKind, SavedAddress } from "@/lib/addresses";
import { type CategoryId, type Lift, type TaskConditions } from "@/lib/engine";
import { type JobVariety } from "@/lib/engine/job-varieties";
import { toUbLocal } from "@/lib/format";
import type { LucideIcon } from "lucide-react";
import { Briefcase, House, MapPin } from "lucide-react";

/** One decision per screen (redesign): kind of task → what exactly → where & when → review. */
export const STEPS = ["type", "what", "where", "review"] as const;
export const KM = [1, 3, 5, 10];
/** "About how long?" choices, in minutes. */
export const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480];

/** "flexible": not urgent — the post stays open for the Ops search window (24 h), offers don't lapse. */
type When = "now" | "today" | "tomorrow" | "pick" | "flexible";
export const KIND_ICON: Record<AddressKind, LucideIcon> = { home: House, work: Briefcase, other: MapPin };

export interface Draft {
  variety?: JobVariety;
  category: CategoryId;
  title: string;
  /** An explicitly chosen title is preserved; otherwise it follows the request message. */
  customTitle?: boolean;
  description: string;
  pickup: string;
  address: string;
  showDetails: boolean;
  entrance: string;
  floor: string;
  unit: string;
  lift: Lift | null;
  note: string;
  km: number;
  when: When;
  time: string;
  date: string;
  carryByHelper: boolean;
  heavy: boolean;
  roundTrip: boolean;
  buyForMe: boolean;
  itemBudget: string;
  budgetBuffer: boolean;
  people: 1 | 2;
  /** The customer's own price as typed ("" = not set yet → the minimum). We only set the floor. */
  price: string;
  /** About how long (minutes); null = the category's usual. */
  minutes: number | null;
  /** The helper must bring tools. */
  tools: boolean;
  /** What the customer requires of the helper (docs/decisions.md 2026-11-18 "Task conditions"). */
  require: TaskConditions;
  /** Save the drop-off address as Home / Work / Other when posting ("" = don't). */
  saveAs: AddressKind | "";
  /** Map pin for the drop-off / task place (drives nearby dispatch). */
  pin: Pin | null;
  /** Two-point tasks: map pin for the pickup. With both pins the distance is measured, not guessed. */
  pickupPin: Pin | null;
  /** "Choose for me": pick the best applicant if I haven't chosen in a few minutes. */
  autoPick: boolean;
}

/** The address fields a saved address fills in. */
export function fromSaved(a: SavedAddress): Partial<Draft> {
  return {
    address: a.address,
    entrance: a.entrance ?? "",
    floor: a.floor === null ? "" : String(a.floor),
    unit: a.unit ?? "",
    lift: a.lift,
    note: a.note ?? "",
    showDetails: false,
    saveAs: "",
    pin: a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null,
  };
}

export const digits = (s: string) => s.replace(/[^\d]/g, "");

/** The scheduled start as a UB wall-time string, or "" for "now". */
export function startString(d: Draft, now: number): string {
  if (d.when === "now" || d.when === "flexible") return "";
  if (d.when === "pick") return d.date;
  const day = toUbLocal(now + (d.when === "tomorrow" ? 86_400_000 : 0)).slice(0, 10);
  return d.time ? `${day}T${d.time}` : "";
}

/**
 * Post a task in 3 steps (DESIGN §5.2–5.5): what → where & details → review & confirm.
 * Prices on screen come from the engine's quoteFee — the server re-runs the same function.
 */
/** A direct request: the helper it goes to first (from their profile). */
export interface InviteTarget {
  id: string;
  name: string;
  categories: CategoryId[];
}
