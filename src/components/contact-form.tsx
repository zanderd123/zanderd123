"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { createContact, deleteContact } from "@/app/actions/contacts";
import type { FormState } from "@/app/actions/applications";
import { SubmitButton, ErrorText } from "@/components/ui";

type AppOption = { id: string; company: string; title: string };

export function ContactForm({ applications }: { applications: AppOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(
    createContact,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn-secondary">
        {open ? "Cancel" : "+ New contact"}
      </button>

      {open && (
        <form
          ref={formRef}
          action={formAction}
          className="mt-4 space-y-4 rounded-lg border border-[var(--border)] p-4"
        >
          <ErrorText>{state?.error}</ErrorText>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Name *
              </label>
              <input id="name" name="name" required className="input" placeholder="Dana Wu" />
            </div>

            <div>
              <label className="label" htmlFor="title">
                Role
              </label>
              <input
                id="title"
                name="title"
                className="input"
                placeholder="Technical Recruiter"
              />
            </div>

            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="input"
                placeholder="dana@acme.com"
              />
            </div>

            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input id="phone" name="phone" className="input" placeholder="(512) 555-0134" />
            </div>

            <div>
              <label className="label" htmlFor="linkedin">
                LinkedIn
              </label>
              <input
                id="linkedin"
                name="linkedin"
                className="input"
                placeholder="linkedin.com/in/danawu"
              />
            </div>

            <div>
              <label className="label" htmlFor="applicationId">
                Linked application
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

          <div>
            <label className="label" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="input"
              placeholder="Met at the Austin meetup, said to ping in January…"
            />
          </div>

          <SubmitButton>Save contact</SubmitButton>
        </form>
      )}
    </>
  );
}

export function DeleteContactButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Delete ${name}`}
      onClick={() => {
        if (confirm(`Delete ${name}?`)) {
          startTransition(() => void deleteContact(id));
        }
      }}
      className="muted shrink-0 text-xs hover:text-rose-600"
    >
      Delete
    </button>
  );
}
