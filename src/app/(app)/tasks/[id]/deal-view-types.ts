import { type FormAction } from "@/components/sheet";
import type { Locale, T } from "@/i18n";
import type { OnTime } from "@/lib/badges";
import type { PublicProfile, TimelineItem } from "@/lib/deals/queries";
import type { DirectPayState, PayeeAccount } from "@/lib/direct-pay";
import type { HelperBadges } from "@/lib/engine";
import { type ErrandDeal } from "@/lib/engine";
import type { JobLocation } from "@/lib/location-rules";
import type { ProofView } from "@/lib/proofs";
import type { TaskPhotoView } from "@/lib/task-photos";
import type { ReactNode } from "react";

export type ApplicantSort = "recommended" | "near" | "rating";

export interface DealViewProps {
  deal: ErrandDeal;
  events: TimelineItem[];
  people: Map<string, PublicProfile>;
  organizations?: Map<string, { id: string; name: string }>;
  viewerId: string;
  serverNow: number;
  /** "Want to raise the price?" after this many minutes with no application (Ops setting). */
  nudgeAfterMinutes?: number;
  t: T;
  locale: Locale;
  /** Stars the viewer already gave, or null. */
  rated: number | null;
  autoOpenPay: boolean;
  mockPay: boolean;
  /** Real payments go through wire.mn's checkout page (else the simulated button). */
  wirePay?: boolean;
  /** Fee-only tasks, once the job is done: what the customer owes the helper and where to pay. */
  directPay?: { state: DirectPayState; account: PayeeAccount | null } | null;
  action: FormAction;
  /** Dispatch progress while the task is open (how many helpers were notified). */
  dispatch?: { notified: number } | null;
  /** Live applicants, best first (dispatch score); the first is "Recommended". */
  /** Live applicants, best first (`rankApplicants`): the first is "Recommended". */
  ranked?: { helperId: string; distanceKm: number | null; rating: number; ratingCount: number; completed: number }[];
  /** How the customer sorts the applicants (the recommendation stays marked either way). */
  applicantSort?: ApplicantSort;
  /** Live helper position during the job (customer only). */
  helperLocation?: JobLocation | null;
  /** Photo / video proof with signed URLs. */
  proofs?: ProofView[];
  /** The customer's own photos of the task (signed URLs). */
  photos?: TaskPhotoView[];
  /** The customer may still change them (their task, still open). */
  photosEditable?: boolean;
  /** Chat entry (null when there's no conversation for this viewer). */
  chat?: { unread: number } | null;
  /** Unread messages per applicant (while choosing). */
  applicantUnread?: Map<string, number>;
  /** Care work: applicants the customer has already had a real call with (needed before choosing). */
  careCalls?: Set<string>;
  /** A call before choosing is required (care work, or the customer's "talk first" condition). */
  needsCall?: boolean;
  /** Applicants' badges for the task's conditions (driver, car, checked, on time, languages). */
  applicantBadges?: Map<string, HelperBadges & { record: OnTime }>;
  /** The handover code to tell the helper at handover (customer only, while the job runs). */
  handoverCode?: string | null;
  /** Care: applicants this family already had a finished care job with (no "meet first" needed). */
  careKnown?: Set<string>;
  /** Care: the required call length (Ops rule). */
  careCallSeconds?: number;
  /** Care: applicants with an Ops-approved first-aid certificate. */
  firstAid?: Set<string>;
  /** SOS / report-a-problem row (client component, passed in by the page). */
  safety?: ReactNode;
  /** Finished task: the helper's request to show photos + the task's public photos. */
  workPhotos?: ReactNode;
}
