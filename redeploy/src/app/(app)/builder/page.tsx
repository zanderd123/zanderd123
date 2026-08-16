import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBook } from "@/lib/view";
import { Builder } from "@/components/builder";

export default async function BuilderPage() {
  const user = await requireUser();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  const book = await loadBook(agency);

  const assignments = book.map((r) => ({
    id: r.id,
    label: `${r.name} — ${r.facility}`,
    billRate: 0,
    taxableRate: 0,
    housingWeekly: 0,
    mieWeekly: 0,
    hoursPerWeek: 36,
    weeks: r.weeks,
  }));

  // Pull the real package figures alongside the labels.
  const raw = await prisma.assignment.findMany({
    where: { agencyId: agency.id, id: { in: book.map((b) => b.id) } },
    select: {
      id: true,
      billRate: true,
      taxableRate: true,
      housingWeekly: true,
      mieWeekly: true,
      hoursPerWeek: true,
    },
  });
  const byId = new Map(raw.map((r) => [r.id, r]));
  for (const a of assignments) {
    const r = byId.get(a.id);
    if (!r) continue;
    a.billRate = r.billRate;
    a.taxableRate = r.taxableRate;
    a.housingWeekly = r.housingWeekly;
    a.mieWeekly = r.mieWeekly;
    a.hoursPerWeek = r.hoursPerWeek;
  }

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>Package builder</h1>
        <p className="sub2">
          Build a pay package against a bill rate and watch the margin as you type. Start from an
          existing assignment or work from scratch.
        </p>
      </div>

      <Builder
        assignments={assignments}
        burdenRate={agency.burdenRate}
        marginFloor={agency.marginFloor}
      />
    </div>
  );
}
