import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Board, type BoardCard } from "@/components/board";
import { EmptyState } from "@/components/ui";
import { BOARD_COLUMNS } from "@/lib/statuses";

export default async function BoardPage() {
  const user = await requireUser();

  const applications = await prisma.application.findMany({
    where: { userId: user.id, archived: false, status: { in: BOARD_COLUMNS } },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { interviews: true } } },
  });

  const cards: BoardCard[] = applications.map((a) => ({
    id: a.id,
    company: a.company,
    title: a.title,
    location: a.location,
    status: a.status,
    priority: a.priority,
    salaryMin: a.salaryMin,
    salaryMax: a.salaryMax,
    currency: a.currency,
    updatedAt: a.updatedAt.toISOString(),
    interviewCount: a._count.interviews,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="muted mt-1 text-sm">
            Drag a card between columns to update its status.
          </p>
        </div>
        <Link href="/applications/new" className="btn-primary">
          + Add application
        </Link>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="Your board is empty"
          body="Add an application and it'll show up here, ready to drag through your pipeline."
          action={
            <Link href="/applications/new" className="btn-primary">
              Add an application
            </Link>
          }
        />
      ) : (
        <Board cards={cards} />
      )}
    </div>
  );
}
