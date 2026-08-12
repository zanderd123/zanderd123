import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/ui";
import { InterviewDialog } from "@/components/interview-dialog";
import { InterviewOutcome } from "@/components/interview-outcome";
import { formatDateTime, relativeDays } from "@/lib/format";
import { INTERVIEW_TYPE_LABEL } from "@/lib/statuses";

export default async function InterviewsPage() {
  const user = await requireUser();
  const now = new Date();

  const [interviews, applications] = await Promise.all([
    prisma.interview.findMany({
      where: { userId: user.id },
      orderBy: { scheduledAt: "asc" },
      include: { application: { select: { id: true, company: true, title: true } } },
    }),
    prisma.application.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { company: "asc" },
      select: { id: true, company: true, title: true },
    }),
  ]);

  const upcoming = interviews.filter(
    (iv) => iv.scheduledAt >= now && iv.outcome === "PENDING",
  );
  const past = interviews
    .filter((iv) => iv.scheduledAt < now || iv.outcome !== "PENDING")
    .reverse();

  const renderRow = (iv: (typeof interviews)[number]) => (
    <li key={iv.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1 basis-64">
        <Link
          href={`/applications/${iv.application.id}`}
          className="truncate font-medium hover:underline"
        >
          {iv.application.company}
        </Link>
        <p className="muted truncate text-sm">
          {INTERVIEW_TYPE_LABEL[iv.type]} · {iv.application.title}
        </p>
        {iv.interviewers && (
          <p className="muted mt-0.5 truncate text-xs">With {iv.interviewers}</p>
        )}
        {iv.location && (
          <p className="muted mt-0.5 truncate text-xs">{iv.location}</p>
        )}
      </div>

      <div className="shrink-0 text-sm">
        <p className="font-medium">{formatDateTime(iv.scheduledAt)}</p>
        <p className="muted text-xs">
          {relativeDays(iv.scheduledAt)} · {iv.durationMins} min
        </p>
      </div>

      <InterviewOutcome id={iv.id} outcome={iv.outcome} />
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interviews</h1>
          <p className="muted mt-1 text-sm">
            {upcoming.length} upcoming · {past.length} completed
          </p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">Schedule an interview</h2>
        <div className="mt-3">
          <InterviewDialog applications={applications} />
        </div>
      </div>

      {interviews.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          body="Once you land one, schedule it here so the prep notes and the job stay together."
        />
      ) : (
        <>
          <section>
            <h2 className="mb-2 font-semibold">Upcoming</h2>
            {upcoming.length === 0 ? (
              <div className="card muted px-4 py-6 text-sm">
                Nothing scheduled right now.
              </div>
            ) : (
              <div className="card overflow-hidden">
                <ul className="divide-y divide-[var(--border)]">
                  {upcoming.map(renderRow)}
                </ul>
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Past</h2>
              <div className="card overflow-hidden">
                <ul className="divide-y divide-[var(--border)]">{past.map(renderRow)}</ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
