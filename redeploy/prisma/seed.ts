/**
 * Seeds one demo agency with a book of business that exercises every state:
 * secured, watch, at risk, thin margin, and expiring credentials.
 *
 *   npm run db:seed
 * Login: dana@northstar.example / demopassword
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DAY = 86_400_000;
const ahead = (n: number) => new Date(Date.now() + n * DAY);
const ago = (n: number) => new Date(Date.now() - n * DAY);

const RECRUITERS = [
  { email: "dana@northstar.example", name: "Dana Whitfield", role: "OWNER" as const },
  { email: "priya@northstar.example", name: "Priya Raman", role: "RECRUITER" as const },
  { email: "marcus@northstar.example", name: "Marcus Bell", role: "RECRUITER" as const },
];

const BOOK = [
  { name: "Marisa Ortega", spec: "ICU", rec: 0, facility: "St. Vincent Medical Center", city: "Portland", state: "OR",
    ends: 12, bill: 112, taxable: 24, housing: 1250, mie: 420, hours: 36, ext: "DECLINED" as const,
    contact: 19, next: null, creds: [["OR RN License", 240], ["BLS", 35], ["ACLS", 9]] },
  { name: "Tyrell Banks", spec: "ED", rec: 0, facility: "Mercy General", city: "Sacramento", state: "CA",
    ends: 21, bill: 126, taxable: 26, housing: 1480, mie: 455, hours: 36, ext: "NOT_ASKED" as const,
    contact: 26, next: null, creds: [["CA RN License", 410], ["BLS", 190], ["PALS", 21]] },
  { name: "Amara Nwosu", spec: "OR", rec: 1, facility: "Baylor Scott & White", city: "Dallas", state: "TX",
    ends: 9, bill: 134, taxable: 29, housing: 1310, mie: 430, hours: 40, ext: "SIGNED" as const,
    contact: 2, next: "Extension signed", creds: [["TX RN (Compact)", 520], ["BLS", 300], ["CNOR", 150]] },
  { name: "Colin Vasquez", spec: "Telemetry", rec: 1, facility: "Ascension Saint Thomas", city: "Nashville", state: "TN",
    ends: 31, bill: 104, taxable: 23, housing: 1100, mie: 390, hours: 36, ext: "INTERESTED" as const,
    contact: 6, next: null, creds: [["TN RN (Compact)", 88], ["BLS", 240]] },
  { name: "Rhea Kapoor", spec: "L&D", rec: 2, facility: "Swedish Medical Center", city: "Seattle", state: "WA",
    ends: 5, bill: 129, taxable: 27, housing: 1520, mie: 470, hours: 36, ext: "NO_RESPONSE" as const,
    contact: 33, next: null, creds: [["WA RN License", 60], ["BLS", -4], ["NRP", 75]] },
  { name: "Jonah Feldman", spec: "Med-Surg", rec: 2, facility: "Banner Desert", city: "Mesa", state: "AZ",
    ends: 47, bill: 96, taxable: 21, housing: 1020, mie: 365, hours: 36, ext: "NOT_ASKED" as const,
    contact: 3, next: null, creds: [["AZ RN (Compact)", 700], ["BLS", 420]] },
  { name: "Simone Adeyemi", spec: "PCU", rec: 0, facility: "UPMC Presbyterian", city: "Pittsburgh", state: "PA",
    ends: 16, bill: 118, taxable: 25, housing: 1180, mie: 410, hours: 36, ext: "DECLINED" as const,
    contact: 1, next: "Offer out — Cleveland Clinic", creds: [["PA RN License", 320], ["BLS", 28], ["ACLS", 190]] },
  { name: "Derek Lindqvist", spec: "Cath Lab", rec: 1, facility: "Intermountain Medical", city: "Murray", state: "UT",
    ends: 26, bill: 141, taxable: 31, housing: 1240, mie: 425, hours: 40, ext: "NO_RESPONSE" as const,
    contact: 41, next: null, creds: [["UT RN (Compact)", 140], ["BLS", 12], ["RCIS", 60]] },
  { name: "Bianca Ruiz", spec: "ICU", rec: 2, facility: "Tampa General", city: "Tampa", state: "FL",
    ends: 38, bill: 121, taxable: 26, housing: 1210, mie: 415, hours: 36, ext: "SIGNED" as const,
    contact: 4, next: "Extension signed", creds: [["FL RN (Compact)", 600], ["BLS", 260], ["CCRN", 400]] },
  // Deliberately thin: bill barely covers a rich package.
  { name: "Priyanka Shah", spec: "Med-Surg", rec: 1, facility: "Adventist Health", city: "Roseville", state: "CA",
    ends: 55, bill: 88, taxable: 24, housing: 1350, mie: 450, hours: 36, ext: "NOT_ASKED" as const,
    contact: 8, next: null, creds: [["CA RN License", 300], ["BLS", 180]] },
];

async function main() {
  const existing = await prisma.agency.findUnique({ where: { slug: "northstar" } });
  if (existing) {
    await prisma.agency.delete({ where: { id: existing.id } });
    console.log("Removed the previous demo agency.");
  }

  const agency = await prisma.agency.create({
    data: { name: "Northstar Staffing", slug: "northstar", marginFloor: 0.22, burdenRate: 0.19 },
  });

  const hash = await bcrypt.hash("demopassword", 12);
  const users = [];
  for (const r of RECRUITERS) {
    users.push(
      await prisma.user.create({
        data: { agencyId: agency.id, email: r.email, name: r.name, role: r.role, passwordHash: hash },
      }),
    );
  }

  for (const [i, b] of BOOK.entries()) {
    const facility = await prisma.facility.upsert({
      where: { agencyId_name: { agencyId: agency.id, name: b.facility } },
      create: { agencyId: agency.id, name: b.facility, city: b.city, state: b.state },
      update: {},
    });

    const traveler = await prisma.traveler.create({
      data: {
        agencyId: agency.id,
        externalId: `seed-${i + 1}`,
        name: b.name,
        specialty: b.spec,
        recruiterId: users[b.rec].id,
        source: "SEED",
        credentials: {
          create: b.creds.map(([name, days]) => ({
            name: String(name),
            expiresAt: ahead(Number(days)),
          })),
        },
        touchpoints: { create: { kind: "CALL", occurredAt: ago(b.contact), note: "Check-in" } },
      },
    });

    await prisma.assignment.create({
      data: {
        agencyId: agency.id,
        externalId: `seed-a-${i + 1}`,
        travelerId: traveler.id,
        facilityId: facility.id,
        startsAt: ahead(b.ends - 91),
        endsAt: ahead(b.ends),
        hoursPerWeek: b.hours,
        billRate: b.bill,
        taxableRate: b.taxable,
        housingWeekly: b.housing,
        mieWeekly: b.mie,
        status: "ACTIVE",
        extensionStatus: b.ext,
        nextStep: b.next,
      },
    });
  }

  console.log(`Seeded ${BOOK.length} assignments for ${agency.name}`);
  console.log("Login: dana@northstar.example / demopassword");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
