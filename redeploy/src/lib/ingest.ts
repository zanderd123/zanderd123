import "server-only";

import { prisma } from "@/lib/db";
import type { SourcePayload } from "@/lib/sources/types";

export type IngestResult = {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

/**
 * Writes a normalised payload into one agency's data.
 *
 * Upserts on `externalId` so re-running an import updates rows rather than
 * duplicating them — which matters because agencies will re-export the same
 * spreadsheet weekly. Anything the agency has edited by hand inside Redeploy
 * (extension status, next step, contact log) is only filled in when the source
 * actually supplies a value, so a sync never wipes a recruiter's own notes.
 */
export async function ingest(
  agencyId: string,
  payload: SourcePayload,
  source: string,
): Promise<IngestResult> {
  const warnings = [...payload.warnings];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Recruiters are matched by email against existing users; unknown emails are
  // left unassigned rather than silently creating accounts.
  const emails = payload.travelers
    .map((t) => t.recruiterEmail?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  const recruiters = emails.length
    ? await prisma.user.findMany({
        where: { agencyId, email: { in: [...new Set(emails)] } },
        select: { id: true, email: true },
      })
    : [];
  const recruiterByEmail = new Map(recruiters.map((r) => [r.email.toLowerCase(), r.id]));

  const unmatched = [...new Set(emails)].filter((e) => !recruiterByEmail.has(e));
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length} recruiter email${unmatched.length === 1 ? "" : "s"} did not match a user in this agency; those travelers are unassigned.`,
    );
  }

  const travelerIdByExternal = new Map<string, string>();

  for (const t of payload.travelers) {
    const recruiterId = t.recruiterEmail
      ? (recruiterByEmail.get(t.recruiterEmail.trim().toLowerCase()) ?? null)
      : null;

    const existing = await prisma.traveler.findUnique({
      where: { agencyId_externalId: { agencyId, externalId: t.externalId } },
      select: { id: true },
    });

    const row = await prisma.traveler.upsert({
      where: { agencyId_externalId: { agencyId, externalId: t.externalId } },
      create: {
        agencyId,
        externalId: t.externalId,
        name: t.name,
        specialty: t.specialty ?? null,
        email: t.email ?? null,
        phone: t.phone ?? null,
        recruiterId,
        source,
      },
      update: {
        name: t.name,
        // Only overwrite when the source actually has a value.
        ...(t.specialty ? { specialty: t.specialty } : {}),
        ...(t.email ? { email: t.email } : {}),
        ...(t.phone ? { phone: t.phone } : {}),
        ...(recruiterId ? { recruiterId } : {}),
      },
      select: { id: true },
    });

    travelerIdByExternal.set(t.externalId, row.id);
    if (existing) updated++;
    else created++;

    if (t.credentials?.length) {
      // Credentials are replaced wholesale — the source is authoritative and
      // there is no in-app editing of them yet.
      await prisma.credential.deleteMany({ where: { travelerId: row.id } });
      await prisma.credential.createMany({
        data: t.credentials.map((c) => ({
          travelerId: row.id,
          name: c.name,
          kind: c.kind ?? "CERT",
          expiresAt: c.expiresAt ?? null,
        })),
      });
    }
  }

  for (const a of payload.assignments) {
    const travelerId = travelerIdByExternal.get(a.travelerExternalId);
    if (!travelerId) {
      skipped++;
      warnings.push(`Assignment ${a.externalId} references an unknown traveler, skipped.`);
      continue;
    }

    const facility = await prisma.facility.upsert({
      where: { agencyId_name: { agencyId, name: a.facilityName } },
      create: { agencyId, name: a.facilityName, city: a.city ?? null, state: a.state ?? null },
      update: {
        ...(a.city ? { city: a.city } : {}),
        ...(a.state ? { state: a.state } : {}),
      },
      select: { id: true },
    });

    const existing = await prisma.assignment.findUnique({
      where: { agencyId_externalId: { agencyId, externalId: a.externalId } },
      select: { id: true },
    });

    await prisma.assignment.upsert({
      where: { agencyId_externalId: { agencyId, externalId: a.externalId } },
      create: {
        agencyId,
        externalId: a.externalId,
        travelerId,
        facilityId: facility.id,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        hoursPerWeek: a.hoursPerWeek ?? 36,
        billRate: a.billRate,
        taxableRate: a.taxableRate,
        housingWeekly: a.housingWeekly ?? 0,
        mieWeekly: a.mieWeekly ?? 0,
        travelReimbursement: a.travelReimbursement ?? 0,
        completionBonus: a.completionBonus ?? 0,
        status: a.status ?? "ACTIVE",
        extensionStatus: a.extensionStatus ?? "NOT_ASKED",
        nextStep: a.nextStep ?? null,
      },
      update: {
        facilityId: facility.id,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        hoursPerWeek: a.hoursPerWeek ?? 36,
        billRate: a.billRate,
        taxableRate: a.taxableRate,
        ...(a.housingWeekly ? { housingWeekly: a.housingWeekly } : {}),
        ...(a.mieWeekly ? { mieWeekly: a.mieWeekly } : {}),
        ...(a.status ? { status: a.status } : {}),
        // Extension status and next step are recruiter-owned once set in-app,
        // so a re-import only fills them when the source is explicit.
        ...(a.extensionStatus && a.extensionStatus !== "NOT_ASKED"
          ? { extensionStatus: a.extensionStatus }
          : {}),
        ...(a.nextStep ? { nextStep: a.nextStep } : {}),
      },
    });

    if (existing) updated++;
    else created++;

    if (a.lastContactAt) {
      const already = await prisma.touchpoint.findFirst({
        where: { travelerId, occurredAt: a.lastContactAt },
        select: { id: true },
      });
      if (!already) {
        await prisma.touchpoint.create({
          data: { travelerId, kind: "IMPORTED", occurredAt: a.lastContactAt, note: "From import" },
        });
      }
    }
  }

  await prisma.importBatch.create({
    data: {
      agencyId,
      source,
      created,
      updated,
      skipped,
      errors: warnings.length ? warnings.slice(0, 40).join("\n") : null,
    },
  });

  return { created, updated, skipped, warnings };
}
