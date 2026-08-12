"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";

import { createReminder, deleteReminder } from "@/app/actions/reminders";
import type { FormState } from "@/app/actions/applications";
import { SubmitButton, ErrorText } from "@/components/ui";

type AppOption = { id: string; company: string; title: string };

export function ReminderForm({ applications }: { applications: AppOption[] }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    createReminder,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <ErrorText>{state?.error}</ErrorText>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <label className="label" htmlFor="title">
            Reminder *
          </label>
          <input
            id="title"
            name="title"
            required
            className="input"
            placeholder="Follow up with Acme recruiter"
          />
        </div>

        <div>
          <label className="label" htmlFor="dueAt">
            Due *
          </label>
          <input id="dueAt" name="dueAt" type="date" required className="input" />
        </div>

        <div>
          <label className="label" htmlFor="applicationId">
            Application
          </label>
          <select id="applicationId" name="applicationId" className="input" defaultValue="">
            <option value="">None</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.company} — {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SubmitButton>Add reminder</SubmitButton>
    </form>
  );
}

export function DeleteReminderButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Delete reminder"
      onClick={() => startTransition(() => void deleteReminder(id))}
      className="muted shrink-0 text-xs hover:text-rose-600"
    >
      Delete
    </button>
  );
}
