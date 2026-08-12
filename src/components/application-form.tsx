"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { Application } from "@prisma/client";

import { lookupJobUrl, type FormState } from "@/app/actions/applications";
import { SubmitButton, ErrorText } from "@/components/ui";
import { STATUS_ORDER, STATUS_LABEL, WORK_MODE_LABEL } from "@/lib/statuses";
import { toDateInput } from "@/lib/format";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function ApplicationForm({
  action,
  application,
  submitLabel,
}: {
  action: Action;
  application?: Application;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const [lookingUp, startLookup] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  // Controlled so the URL lookup can populate them.
  const [company, setCompany] = useState(application?.company ?? "");
  const [title, setTitle] = useState(application?.title ?? "");
  const [location, setLocation] = useState(application?.location ?? "");
  const [url, setUrl] = useState(application?.url ?? "");
  const [source, setSource] = useState(application?.source ?? "");
  const [description, setDescription] = useState(application?.description ?? "");
  const [workMode, setWorkMode] = useState(application?.workMode ?? "UNKNOWN");
  const [salaryMin, setSalaryMin] = useState(
    application?.salaryMin ? String(application.salaryMin) : "",
  );
  const [salaryMax, setSalaryMax] = useState(
    application?.salaryMax ? String(application.salaryMax) : "",
  );

  const runLookup = () => {
    setNotice(null);
    startLookup(async () => {
      const result = await lookupJobUrl(url);

      // Only fill blanks — never clobber something already typed.
      if (result.company && !company) setCompany(result.company);
      if (result.title && !title) setTitle(result.title);
      if (result.location && !location) setLocation(result.location);
      if (result.source && !source) setSource(result.source);
      if (result.description && !description) setDescription(result.description);
      if (result.workMode && workMode === "UNKNOWN") setWorkMode(result.workMode);
      if (result.salaryMin && !salaryMin) setSalaryMin(String(result.salaryMin));
      if (result.salaryMax && !salaryMax) setSalaryMax(String(result.salaryMax));

      setNotice(
        result.warning ??
          (result.title || result.company
            ? "Filled in what we could find — check it over before saving."
            : "Nothing new found on that page."),
      );
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      <ErrorText>{state?.error}</ErrorText>

      <section className="card p-5">
        <h2 className="font-semibold">Job posting link</h2>
        <p className="muted mt-1 text-sm">
          Paste the URL and we&apos;ll try to pull the company, title, location, and
          description. Some boards block this — you can always type it in yourself.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            name="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://boards.greenhouse.io/acme/jobs/12345"
            className="input min-w-56 flex-1"
            aria-label="Job posting URL"
          />
          <button
            type="button"
            onClick={runLookup}
            disabled={lookingUp || !url.trim()}
            className="btn-secondary"
          >
            {lookingUp ? "Fetching…" : "Fetch details"}
          </button>
        </div>

        {notice && <p className="muted mt-3 text-sm">{notice}</p>}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">The role</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="company">
              Company *
            </label>
            <input
              id="company"
              name="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              className="input"
              placeholder="Acme Corp"
            />
          </div>

          <div>
            <label className="label" htmlFor="title">
              Job title *
            </label>
            <input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="input"
              placeholder="Senior Product Designer"
            />
          </div>

          <div>
            <label className="label" htmlFor="location">
              Location
            </label>
            <input
              id="location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
              placeholder="Austin, TX"
            />
          </div>

          <div>
            <label className="label" htmlFor="workMode">
              Work mode
            </label>
            <select
              id="workMode"
              name="workMode"
              value={workMode}
              onChange={(e) => setWorkMode(e.target.value as typeof workMode)}
              className="input"
            >
              {Object.entries(WORK_MODE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="salaryMin">
              Salary range (low)
            </label>
            <input
              id="salaryMin"
              name="salaryMin"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
              inputMode="numeric"
              className="input"
              placeholder="120000"
            />
          </div>

          <div>
            <label className="label" htmlFor="salaryMax">
              Salary range (high)
            </label>
            <input
              id="salaryMax"
              name="salaryMax"
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
              inputMode="numeric"
              className="input"
              placeholder="150000"
            />
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Tracking</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={application?.status ?? "APPLIED"}
              className="input"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="appliedAt">
              Date applied
            </label>
            <input
              id="appliedAt"
              name="appliedAt"
              type="date"
              defaultValue={toDateInput(application?.appliedAt)}
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              defaultValue={application?.priority ?? "MEDIUM"}
              className="input"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="source">
            Source
          </label>
          <input
            id="source"
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="input"
            placeholder="LinkedIn, referral, company site…"
          />
        </div>
      </section>

      <section className="card p-5">
        <label className="label" htmlFor="description">
          Job description
        </label>
        <p className="muted mb-2 text-sm">
          Keep a copy — postings get taken down, and it&apos;s useful for interview prep.
        </p>
        <textarea
          id="description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          className="input font-mono text-xs leading-relaxed"
          placeholder="Paste the job description here…"
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link
          href={application ? `/applications/${application.id}` : "/applications"}
          className="btn-secondary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
