import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StatusChip, EmptyState } from "@/components/ui";
import { formatDateTime, relativeDays, daysSince } from "@/lib/format";
import {
  BOARD_COLUMNS,
  STATUS_LABEL,
  STATUS_DOT,
  RESPONDED_STATUSES,
  CLOSED_STATUSES,
} from "@/lib/statuses";
import { INTERVIEW_TYPE_LABEL } from "@/lib/statuses";
import { ToggleReminder } from "@/components/reminder-toggle";

/** Applications with no movement in this many days are "gone quiet". */
const STALE_DAYS = 14;

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [apps, upcomingInterviews, openReminders] = await Promise.all([
    prisma.application.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        company: true,
        title: true,
        status: true,
        appliedAt: true,
        updatedAt: true,
      },
    }),
    prisma.interview.findMany({
      where: { userId: user.id, scheduledAt: { gte: now }, outcome: "PENDING" },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      include: { application: { select: { id: true, company: true, title: true } } },
    }),
    prisma.reminder.findMany({
      where: { userId: user.id, done: false },
      orderBy: { dueAt: "asc" },
      take: 6,
      include: { application: { select: { id: true, company: true } } },
    }),
  ]);

  const total = apps.length;
  const submitted = apps.filter((a) => a.status !== "SAVED").length;
  const responded = apps.filter((a) => RESPONDED_STATUSES.includes(a.status)).length;
  const interviewed = apps.filter((a) =>
    ["INTERVIEW", "OFFER", "ACCEPTED"].includes(a.status),
  ).length;
  const offers = apps.filter((a) => ["OFFER", "ACCEPTED"].includes(a.status)).length;
  const active = apps.filter((a) => !CLOSED_STATUSES.includes(a.status)).length;

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

  const counts = Object.fromEntries(
    BOARD_COLUMNS.map((s) => [s, apps.filter((a) => a.status === s).length]),
  );

  // Live applications that haven't moved in two weeks — the follow-up list.
  const stale = apps
    .filter(
      (a) =>
        !CLOSED_STATUSES.includes(a.status) &&
        a.status !== "SAVED" &&
        (daysSince(a.updatedAt) ?? 0) >= STALE_DAYS,
    )
    .slice(0, 5);

  const overdue = openReminders.filter((r) => r.dueAt < now).length;

  const stats = [
    { label: "Total tracked", value: total, hint: `${active} still active` },
    { label: "Response rate", value: pct(responded, submitted), hint: `${responded} of ${submitted} submitted` },
    { label: "Interview rate", value: pct(interviewed, submitted), hint: `${interviewed} reached interview` },
    { label: "Offers", value: offers, hint: pct(offers, submitted) + " of submitted" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.name ? `Hi ${user.name.split(" ")[0]},` : "Dashboard"}
          </h1>
          <p className="muted mt-1 text-sm">
            {total === 0
              ? "Add your first application to get started."
              : `You're tracking ${total} ${total === 1 ? "role" : "roles"}, ${active} still in play.`}
          </p>
        </div>
        <Link href="/applications/new" className="btn-primary sm:hidden">
          + Add application
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="muted text-sm">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="muted mt-1 text-xs">{s.hint}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pipeline</h2>
          <Link
            href="/board"
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
          >
            Open board →
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {BOARD_COLUMNS.map((s) => (
            <Link
              key={s}
              href={`/applications?status=${s}`}
              className="rounded-lg border border-[var(--border)] p-3 transition hover:border-indigo-400"
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                <span className="muted text-xs">{STATUS_LABEL[s]}</span>
              </span>
              <p className="mt-1 text-xl font-semibold tabular-nums">{counts[s]}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-semibold">Upcoming interviews</h2>

          {upcomingInterviews.length === 0 ? (
            <p className="muted mt-4 text-sm">
              Nothing scheduled.{" "}
              <Link href="/interviews" className="text-indigo-600 dark:text-indigo-400">
                Add an interview
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {upcomingInterviews.map((iv) => (
                <li key={iv.id}>
                  <Link
                    href={`/applications/${iv.application.id}`}
                    className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-black/[.03] dark:hover:bg-white/[.05]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {iv.application.company}
                      </p>
                      <p className="muted truncate text-xs">
                        {INTERVIEW_TYPE_LABEL[iv.type]} · {iv.application.title}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium">{formatDateTime(iv.scheduledAt)}</p>
                      <p className="muted text-xs">{relativeDays(iv.scheduledAt)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Follow-ups</h2>
            {overdue > 0 && (
              <span className="chip bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                {overdue} overdue
              </span>
            )}
          </div>

          {openReminders.length === 0 ? (
            <p className="muted mt-4 text-sm">
              No open reminders.{" "}
              <Link href="/reminders" className="text-indigo-600 dark:text-indigo-400">
                Add one
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {openReminders.map((r) => (
                <li key={r.id} className="flex items-start gap-3">
                  <ToggleReminder id={r.id} done={r.done} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.title}</p>
                    <p
                      className={`text-xs ${
                        r.dueAt < now
                          ? "font-medium text-rose-600 dark:text-rose-400"
                          : "muted"
                      }`}
                    >
                      {r.application ? `${r.application.company} · ` : ""}
                      {relativeDays(r.dueAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Gone quiet</h2>
        <p className="muted mt-1 text-sm">
          Active applications with no update in {STALE_DAYS}+ days. Good candidates for
          a nudge.
        </p>

        {stale.length === 0 ? (
          <p className="muted mt-4 text-sm">Nothing stale — you&apos;re on top of it.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {stale.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/applications/${a.id}`}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-black/[.03] dark:hover:bg-white/[.05]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.company}</p>
                    <p className="muted truncate text-xs">{a.title}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusChip status={a.status} />
                    <span className="muted w-24 text-right text-xs">
                      {relativeDays(a.updatedAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {total === 0 && (
        <EmptyState
          title="No applications yet"
          body="Add the first role you've applied to — or paste a job posting URL and let TrackWise fill in the details."
          action={
            <Link href="/applications/new" className="btn-primary">
              Add your first application
            </Link>
          }
        />
      )}
    </div>
  );
}
