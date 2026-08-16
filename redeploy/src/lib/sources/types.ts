/**
 * Every source of agency data — a CSV export, Bullhorn, or another ATS —
 * normalises into these shapes. Adding a system means writing one adapter,
 * not touching the rest of the app.
 *
 * Note on scope: what this product needs (travelers, current assignments,
 * pay packages, credentials, recruiter ownership) lives in the agency's ATS,
 * not in the VMS. A VMS carries inbound job orders, which is a different
 * problem — see docs/INTEGRATIONS.md.
 */

export type SourceTraveler = {
  externalId: string;
  name: string;
  specialty?: string | null;
  email?: string | null;
  phone?: string | null;
  recruiterEmail?: string | null;
  credentials?: SourceCredential[];
};

export type SourceCredential = {
  name: string;
  kind?: string;
  expiresAt?: Date | null;
};

export type SourceAssignment = {
  externalId: string;
  travelerExternalId: string;
  facilityName: string;
  city?: string | null;
  state?: string | null;
  startsAt: Date;
  endsAt: Date;
  hoursPerWeek?: number;
  billRate: number;
  taxableRate: number;
  housingWeekly?: number;
  mieWeekly?: number;
  travelReimbursement?: number;
  completionBonus?: number;
  status?: "PENDING" | "ACTIVE" | "ENDED" | "CANCELLED";
  extensionStatus?: "NOT_ASKED" | "INTERESTED" | "SIGNED" | "DECLINED" | "NO_RESPONSE";
  nextStep?: string | null;
  lastContactAt?: Date | null;
};

export type SourcePayload = {
  travelers: SourceTraveler[];
  assignments: SourceAssignment[];
  warnings: string[];
};

export interface DataSource {
  readonly key: string;
  readonly label: string;
  /** False when the adapter has no credentials configured. */
  isConfigured(): boolean;
  fetch(): Promise<SourcePayload>;
}
