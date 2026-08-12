"use client";

import { useTransition } from "react";
import type { InterviewOutcome as Outcome } from "@prisma/client";

import { setInterviewOutcome, deleteInterview } from "@/app/actions/interviews";

const OUTCOMES: Outcome[] = ["PENDING", "PASSED", "FAILED", "CANCELED"];

const LABEL: Record<Outcome, string> = {
  PENDING: "Pending",
  PASSED: "Passed",
  FAILED: "Didn't advance",
  CANCELED: "Canceled",
};

export function InterviewOutcome({
  id,
  outcome,
}: {
  id: string;
  outcome: Outcome;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <select
        value={outcome}
        disabled={pending}
        aria-label="Interview outcome"
        onChange={(e) =>
          startTransition(() =>
            void setInterviewOutcome(id, e.target.value as Outcome),
          )
        }
        className="input w-auto text-xs"
      >
        {OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {LABEL[o]}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={pending}
        aria-label="Delete interview"
        onClick={() => {
          if (confirm("Delete this interview?")) {
            startTransition(() => void deleteInterview(id));
          }
        }}
        className="muted text-xs hover:text-rose-600"
      >
        Delete
      </button>
    </div>
  );
}
