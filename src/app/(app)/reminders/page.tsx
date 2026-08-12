import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/ui";
import { ReminderForm, DeleteReminderButton } from "@/components/reminder-form";
import { ToggleReminder } from "@/components/reminder-toggle";
import { formatDate, relativeDays } from "@/lib/format";

export default async function RemindersPage() {
  const user = await requireUser();
  const now = new Date();

  const [reminders, applications] = await Promise.all([
    prisma.reminder.findMany({
      where: { userId: user.id },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }],
      include: { application: { select: { id: true, company: true } } },
    }),
    prisma.application.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { company: "asc" },
      select: { id: true, company: true, title: true },
    }),
  ]);

  const open = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);
  const overdue = open.filter((r) => r.dueAt < now);

  const renderRow = (r: (typeof reminders)[number]) => (
    <li key={r.id} className="flex items-start gap-3 px-4 py-3">
      <div className="pt-0.5">
        <ToggleReminder id={r.id} done={r.done} />
      </div>

      <div className="min-w-0 flex-1">
        <p className={`text-sm ${r.done ? "muted line-through" : ""}`}>{r.title}</p>
        <p
          className={`mt-0.5 text-xs ${
            !r.done && r.dueAt < now
              ? "font-medium text-rose-600 dark:text-rose-400"
              : "muted"
          }`}
        >
          {formatDate(r.dueAt)} · {relativeDays(r.dueAt)}
          {r.application && (
            <>
              {" · "}
              <Link
                href={`/applications/${r.application.id}`}
                className="hover:underline"
              >
                {r.application.company}
              </Link>
            </>
          )}
        </p>
      </div>

      <DeleteReminderButton id={r.id} />
    </li>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
        <p className="muted mt-1 text-sm">
          {open.length} open
          {overdue.length > 0 && (
            <span className="font-medium text-rose-600 dark:text-rose-400">
              {" "}
              · {overdue.length} overdue
            </span>
          )}
        </p>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">Add a reminder</h2>
        <div className="mt-3">
          <ReminderForm applications={applications} />
        </div>
      </div>

      {reminders.length === 0 ? (
        <EmptyState
          title="No reminders yet"
          body="Set a nudge to follow up on an application, send a thank-you note, or check back after an interview."
        />
      ) : (
        <>
          <section>
            <h2 className="mb-2 font-semibold">Open</h2>
            {open.length === 0 ? (
              <div className="card muted px-4 py-6 text-sm">All caught up.</div>
            ) : (
              <div className="card overflow-hidden">
                <ul className="divide-y divide-[var(--border)]">{open.map(renderRow)}</ul>
              </div>
            )}
          </section>

          {done.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Completed</h2>
              <div className="card overflow-hidden">
                <ul className="divide-y divide-[var(--border)]">{done.map(renderRow)}</ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
