import "server-only";

import { prisma } from "@/lib/db";
import { computeEconomics, type Economics } from "@/lib/economics";
import { assessRisk, daysUntil, type RiskResult } from "@/lib/risk";

export type BookRow = {
  id: string;
  travelerId: string;
  name: string;
  specialty: string | null;
  recruiter: string;
  facility: string;
  where: string;
  endsAt: Date;
  weeksRemaining: number;
  extensionStatus: string;
  nextStep: string | null;
  lastContactAt: Date | null;
  economics: Economics;
  risk: RiskResult;
  expiring: { name: string; days: number }[];
  weeks: number;
};

/** One query for the whole book, then all derived values computed in memory. */
export async function loadBook(agency: {
  id: string;
  burdenRate: number;
  marginFloor: number;
}): Promise<BookRow[]> {
  const rows = await prisma.assignment.findMany({
    where: { agencyId: agency.id, status: { in: ["ACTIVE", "PENDING"] } },
    include: {
      facility: true,
      traveler: {
        include: {
          recruiter: { select: { name: true, email: true } },
          credentials: true,
          touchpoints: { orderBy: { occurredAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { endsAt: "asc" },
  });

  return rows.map((a) => {
    const weeks = Math.max(
      1,
      Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / (7 * 86_400_000)),
    );
    const economics = computeEconomics(
      {
        billRate: a.billRate,
        taxableRate: a.taxableRate,
        housingWeekly: a.housingWeekly,
        mieWeekly: a.mieWeekly,
        hoursPerWeek: a.hoursPerWeek,
        travelReimbursement: a.travelReimbursement,
        completionBonus: a.completionBonus,
      },
      { burdenRate: agency.burdenRate, weeks },
    );

    const expiring = a.traveler.credentials
      .filter((c) => c.expiresAt)
      .map((c) => ({ name: c.name, days: daysUntil(c.expiresAt!) }))
      .filter((c) => c.days <= 30)
      .sort((x, y) => x.days - y.days);

    const lastContactAt = a.traveler.touchpoints[0]?.occurredAt ?? null;

    const risk = assessRisk({
      endsAt: a.endsAt,
      lastContactAt,
      extensionStatus: a.extensionStatus,
      hasNextStep: Boolean(a.nextStep),
      soonestCredentialDays: expiring.length ? expiring[0].days : null,
    });

    return {
      id: a.id,
      travelerId: a.travelerId,
      name: a.traveler.name,
      specialty: a.traveler.specialty,
      recruiter: a.traveler.recruiter?.name ?? a.traveler.recruiter?.email ?? "Unassigned",
      facility: a.facility.name,
      where: [a.facility.city, a.facility.state].filter(Boolean).join(", "),
      endsAt: a.endsAt,
      weeksRemaining: Math.max(0, Math.round(daysUntil(a.endsAt) / 7)),
      extensionStatus: a.extensionStatus,
      nextStep: a.nextStep,
      lastContactAt,
      economics,
      risk,
      expiring,
      weeks,
    };
  });
}

export function summarise(book: BookRow[], marginFloor: number) {
  const ending = book.filter((r) => daysUntil(r.endsAt) <= 45);
  const secured = ending.filter((r) => r.risk.level === "SECURED");
  const exposed = ending
    .filter((r) => r.risk.level !== "SECURED")
    .reduce((sum, r) => sum + r.economics.marginWeekly * 13, 0);

  return {
    total: book.length,
    ending: ending.length,
    secured: secured.length,
    redeploymentRate: ending.length ? secured.length / ending.length : 0,
    marginAtRisk: exposed,
    belowFloor: book.filter((r) => r.economics.marginPct < marginFloor).length,
    atRisk: book.filter((r) => r.risk.level === "AT_RISK").length,
    quiet: book.filter(
      (r) => r.risk.level !== "SECURED" && (r.risk.daysSinceContact ?? 999) >= 14,
    ).length,
    complianceCount: book.filter((r) => r.expiring.length > 0).length,
  };
}
