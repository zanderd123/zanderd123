"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createInterview } from "@/app/actions/interviews";
import type { FormState } from "@/app/actions/applications";
import { SubmitButton, ErrorText } from "@/components/ui";
import { INTERVIEW_TYPE_LABEL } from "@/lib/statuses";

type AppOption = { id: string; company: string; title: string };

export function InterviewDialog({
  applicationId,
  applications,
  label = "+ Schedule interview",
}: {
  /** Preselected application; omit to render a picker instead. */
  applicationId?: string;
  applications?: AppOption[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(
    createInterview,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  const canSubmit = applicationId || (applications && applications.length > 0);

  if (!canSubmit) {
    return (
      <p className="muted text-sm">Add an application first to schedule interviews.</p>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn-secondary">
        {open ? "Cancel" : label}
      </button>

      {open && (
        <form
          ref={formRef}
          action={formAction}
          className="mt-4 w-full space-y-4 rounded-lg border border-[var(--border)] p-4"
        >
          <ErrorText>{state?.error}</ErrorText>

          {applicationId ? (
            <input type="hidden" name="applicationId" value={applicationId} />
          ) : (
            <div>
              <label className="label" htmlFor="applicationId">
                Application *
              </label>
              <select id="applicationId" name="applicationId" required className="input">
                {applications!.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company} — {a.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="type">
                Round
              </label>
              <select id="type" name="type" className="input" defaultValue="PHONE_SCREEN">
                {Object.entries(INTERVIEW_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="scheduledAt">
                When *
              </label>
              <input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                required
                className="input"
              />
            </div>

            <div>
              <label className="label" htmlFor="durationMins">
                Duration (min)
              </label>
              <input
                id="durationMins"
                name="durationMins"
                type="number"
                min={5}
                max={600}
                defaultValue={60}
                className="input"
              />
            </div>

            <div>
              <label className="label" htmlFor="interviewers">
                Interviewers
              </label>
              <input
                id="interviewers"
                name="interviewers"
                className="input"
                placeholder="Dana Wu, Priya Shah"
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="location">
              Location or link
            </label>
            <input
              id="location"
              name="location"
              className="input"
              placeholder="Zoom link, or 500 Congress Ave, Floor 4"
            />
          </div>

          <div>
            <label className="label" htmlFor="notes">
              Prep notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="input"
              placeholder="Topics to review, questions to ask…"
            />
          </div>

          <SubmitButton>Schedule interview</SubmitButton>
        </form>
      )}
    </>
  );
}
