import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StatusChip, ConfirmButton } from "@/components/ui";
import {
  deleteApplication,
  setArchived,
  addNote,
  deleteNote,
} from "@/app/actions/applications";
import {
  formatDate,
  formatDateTime,
  relativeDays,
  formatSalary,
  daysSince,
} from "@/lib/format";
import {
  STATUS_LABEL,
  INTERVIEW_TYPE_LABEL,
  PRIORITY_LABEL,
  WORK_MODE_LABEL,
} from "@/lib/statuses";
import { StatusPicker } from "@/components/status-picker";
import { InterviewDialog } from "@/components/interview-dialog";
import { ToggleReminder } from "@/components/reminder-toggle";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const app = await prisma.application.findFirst({
    where: { id, userId: user.id },
    include: {
      interviews: { orderBy: { scheduledAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      contacts: { orderBy: { createdAt: "desc" } },
      reminders: { orderBy: { dueAt: "asc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) notFound();

  const salary = formatSalary(app.salaryMin, app.salaryMax, app.currency);
  const age = daysSince(app.appliedAt ?? app.createdAt);

  const facts = [
    { label: "Status", value: STATUS_LABEL[app.status] },
    { label: "Applied", value: app.appliedAt ? formatDate(app.appliedAt) : "Not yet" },
    { label: "Location", value: app.location || "—" },
    { label: "Work mode", value: WORK_MODE_LABEL[app.workMode] },
    { label: "Salary", value: salary ?? "—" },
    { label: "Priority", value: PRIORITY_LABEL[app.priority] },
    { label: "Source", value: app.source || "—" },
    { label: "Days tracked", value: age === null ? "—" : `${age}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/applications" className="muted text-sm hover:underline">
          ← Applications
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{app.company}</h1>
              <StatusChip status={app.status} />
              {app.archived && (
                <span className="chip bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Archived
                </span>
              )}
            </div>
            <p className="muted mt-1">{app.title}</p>
            {app.url && (
              <a
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                View original posting ↗
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPicker id={app.id} status={app.status} />
            <Link href={`/applications/${app.id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <form action={setArchived.bind(null, app.id, !app.archived)}>
              <button type="submit" className="btn-secondary">
                {app.archived ? "Unarchive" : "Archive"}
              </button>
            </form>
            <form action={deleteApplication.bind(null, app.id)}>
              <ConfirmButton message={`Delete the ${app.company} application? This can't be undone.`}>
                Delete
              </ConfirmButton>
            </form>
          </div>
        </div>
      </div>

      <section className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <p className="muted text-xs">{f.label}</p>
            <p className="mt-0.5 truncate text-sm font-medium">{f.value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Interviews</h2>
              <InterviewDialog applicationId={app.id} />
            </div>

            {app.interviews.length === 0 ? (
              <p className="muted mt-4 text-sm">
                No interviews scheduled for this role yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--border)]">
                {app.interviews.map((iv) => (
                  <li key={iv.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {INTERVIEW_TYPE_LABEL[iv.type]}
                        <span className="muted font-normal"> · {iv.durationMins} min</span>
                      </p>
                      <p className="muted mt-0.5 text-xs">
                        {formatDateTime(iv.scheduledAt)} ({relativeDays(iv.scheduledAt)})
                      </p>
                      {iv.interviewers && (
                        <p className="muted mt-0.5 text-xs">With {iv.interviewers}</p>
                      )}
                      {iv.location && (
                        <p className="muted mt-0.5 truncate text-xs">{iv.location}</p>
                      )}
                      {iv.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs">{iv.notes}</p>
                      )}
                    </div>
                    <span
                      className={`chip ${
                        iv.outcome === "PASSED"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : iv.outcome === "FAILED"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            : iv.outcome === "CANCELED"
                              ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {iv.outcome.charAt(0) + iv.outcome.slice(1).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Notes</h2>

            <form action={addNote.bind(null, app.id)} className="mt-3 space-y-2">
              <textarea
                name="body"
                rows={3}
                required
                className="input"
                placeholder="Recruiter said they'd get back by Friday…"
              />
              <button type="submit" className="btn-primary">
                Add note
              </button>
            </form>

            {app.notes.length > 0 && (
              <ul className="mt-5 space-y-3">
                {app.notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-lg border border-[var(--border)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      <form action={deleteNote.bind(null, n.id)}>
                        <button
                          type="submit"
                          className="muted shrink-0 text-xs hover:text-rose-600"
                          aria-label="Delete note"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                    <p className="muted mt-2 text-xs">{formatDateTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {app.description && (
            <section className="card p-5">
              <h2 className="font-semibold">Job description</h2>
              <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/[.02] p-4 text-sm leading-relaxed dark:bg-white/[.03]">
                {app.description}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-semibold">Timeline</h2>
            {app.events.length === 0 ? (
              <p className="muted mt-3 text-sm">No status changes yet.</p>
            ) : (
              <ol className="mt-4 space-y-4">
                {app.events.map((e) => (
                  <li key={e.id} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-indigo-500" />
                    <p className="text-sm">
                      {e.from ? (
                        <>
                          {STATUS_LABEL[e.from]} →{" "}
                          <span className="font-medium">{STATUS_LABEL[e.to]}</span>
                        </>
                      ) : (
                        <span className="font-medium">{STATUS_LABEL[e.to]}</span>
                      )}
                    </p>
                    {e.note && <p className="muted text-xs">{e.note}</p>}
                    <p className="muted text-xs">{formatDateTime(e.createdAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Contacts</h2>
              <Link
                href="/contacts"
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
              >
                Manage
              </Link>
            </div>

            {app.contacts.length === 0 ? (
              <p className="muted mt-3 text-sm">No contacts linked yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {app.contacts.map((c) => (
                  <li key={c.id}>
                    <p className="text-sm font-medium">{c.name}</p>
                    {c.title && <p className="muted text-xs">{c.title}</p>}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {c.email}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Reminders</h2>
              <Link
                href="/reminders"
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
              >
                Add
              </Link>
            </div>

            {app.reminders.length === 0 ? (
              <p className="muted mt-3 text-sm">No reminders for this role.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {app.reminders.map((r) => (
                  <li key={r.id} className="flex items-start gap-3">
                    <ToggleReminder id={r.id} done={r.done} />
                    <div className="min-w-0">
                      <p className={`text-sm ${r.done ? "muted line-through" : ""}`}>
                        {r.title}
                      </p>
                      <p className="muted text-xs">{relativeDays(r.dueAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
