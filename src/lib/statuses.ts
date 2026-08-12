import type { Status, InterviewType, Priority, WorkMode } from "@prisma/client";

export const STATUS_ORDER: Status[] = [
  "SAVED",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "GHOSTED",
];

/** Columns shown on the pipeline board, in order. */
export const BOARD_COLUMNS: Status[] = [
  "SAVED",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
];

export const STATUS_LABEL: Record<Status, string> = {
  SAVED: "Saved",
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  GHOSTED: "Ghosted",
};

/** Tailwind classes per status, used for chips and column headers. */
export const STATUS_STYLE: Record<Status, string> = {
  SAVED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  APPLIED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  SCREENING: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  INTERVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  OFFER: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ACCEPTED: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  WITHDRAWN: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  GHOSTED: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

export const STATUS_DOT: Record<Status, string> = {
  SAVED: "bg-slate-400",
  APPLIED: "bg-blue-500",
  SCREENING: "bg-violet-500",
  INTERVIEW: "bg-amber-500",
  OFFER: "bg-emerald-500",
  ACCEPTED: "bg-teal-500",
  REJECTED: "bg-rose-500",
  WITHDRAWN: "bg-zinc-400",
  GHOSTED: "bg-orange-500",
};

/** Statuses that mean the application is no longer moving forward. */
export const CLOSED_STATUSES: Status[] = [
  "REJECTED",
  "WITHDRAWN",
  "GHOSTED",
  "ACCEPTED",
];

export const isClosed = (s: Status) => CLOSED_STATUSES.includes(s);

/** Statuses that count as "reached a human conversation". */
export const RESPONDED_STATUSES: Status[] = [
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "ACCEPTED",
];

export const INTERVIEW_TYPE_LABEL: Record<InterviewType, string> = {
  PHONE_SCREEN: "Phone screen",
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioral",
  ONSITE: "Onsite",
  FINAL: "Final round",
  OTHER: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  LOW: "text-slate-500",
  MEDIUM: "text-blue-600 dark:text-blue-400",
  HIGH: "text-rose-600 dark:text-rose-400",
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "Onsite",
  UNKNOWN: "Not specified",
};
