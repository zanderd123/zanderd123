import Link from "next/link";
import type { Prisma, Status } from "@prisma/client";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StatusChip, EmptyState } from "@/components/ui";
import { formatDate, relativeDays, formatSalary } from "@/lib/format";
import { STATUS_ORDER, STATUS_LABEL, PRIORITY_STYLE } from "@/lib/statuses";
import { ApplicationFilters } from "@/components/application-filters";

type SearchParams = Promise<{
  status?: string;
  q?: string;
  sort?: string;
  archived?: string;
}>;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const status = STATUS_ORDER.includes(params.status as Status)
    ? (params.status as Status)
    : undefined;
  const q = params.q?.trim() || undefined;
  const showArchived = params.archived === "1";
  const sort = params.sort ?? "recent";

  const where: Prisma.ApplicationWhereInput = {
    userId: user.id,
    archived: showArchived,
    ...(status && { status }),
    ...(q && {
      OR: [
        { company: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const orderBy: Prisma.ApplicationOrderByWithRelationInput =
    sort === "company"
      ? { company: "asc" }
      : sort === "applied"
        ? { appliedAt: "desc" }
        : sort === "priority"
          ? { priority: "desc" }
          : { updatedAt: "desc" };

  const [applications, totalCount] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy,
      include: { _count: { select: { interviews: true, notes: true } } },
    }),
    prisma.application.count({ where: { userId: user.id, archived: false } }),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="muted mt-1 text-sm">
            {applications.length} {applications.length === 1 ? "result" : "results"}
            {status ? ` in ${STATUS_LABEL[status]}` : ""}
            {showArchived ? " · archived" : ""}
          </p>
        </div>
        <Link href="/applications/new" className="btn-primary">
          + Add application
        </Link>
      </div>

      <ApplicationFilters />

      {applications.length === 0 ? (
        <EmptyState
          title={totalCount === 0 ? "No applications yet" : "No matches"}
          body={
            totalCount === 0
              ? "Track your first role — paste a job posting URL and TrackWise will fill in what it can."
              : "Try a different search or clear the filters."
          }
          action={
            totalCount === 0 ? (
              <Link href="/applications/new" className="btn-primary">
                Add your first application
              </Link>
            ) : (
              <Link href="/applications" className="btn-secondary">
                Clear filters
              </Link>
            )
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {applications.map((a) => {
              const salary = formatSalary(a.salaryMin, a.salaryMax, a.currency);
              return (
                <li key={a.id}>
                  <Link
                    href={`/applications/${a.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-black/[.03] dark:hover:bg-white/[.05]"
                  >
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="truncate font-medium">
                        {a.company}
                        {a.priority === "HIGH" && (
                          <span className={`ml-2 text-xs ${PRIORITY_STYLE.HIGH}`}>
                            ★ high
                          </span>
                        )}
                      </p>
                      <p className="muted truncate text-sm">
                        {a.title}
                        {a.location ? ` · ${a.location}` : ""}
                      </p>
                    </div>

                    <div className="muted hidden w-28 shrink-0 text-sm tabular-nums lg:block">
                      {salary ?? "—"}
                    </div>

                    <div className="muted hidden w-32 shrink-0 text-sm sm:block">
                      {a._count.interviews > 0 && (
                        <span>
                          {a._count.interviews}{" "}
                          {a._count.interviews === 1 ? "interview" : "interviews"}
                        </span>
                      )}
                    </div>

                    <div className="w-28 shrink-0">
                      <StatusChip status={a.status} />
                    </div>

                    <div className="muted w-24 shrink-0 text-right text-xs">
                      {a.appliedAt ? formatDate(a.appliedAt) : relativeDays(a.updatedAt)}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
