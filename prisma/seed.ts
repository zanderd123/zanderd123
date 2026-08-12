/**
 * Seeds a demo account so you can see the app with realistic data.
 *   npm run db:seed
 * Login: demo@trackwise.app / demopassword
 */
import { PrismaClient, type Status, type Application } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@trackwise.app";
const DEMO_PASSWORD = "demopassword";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

const APPLICATIONS = [
  {
    company: "Vercel",
    title: "Senior Frontend Engineer",
    location: "Remote (US)",
    workMode: "REMOTE" as const,
    status: "INTERVIEW" as Status,
    priority: "HIGH" as const,
    source: "Company site",
    salaryMin: 180000,
    salaryMax: 220000,
    appliedAt: daysAgo(21),
    description:
      "Build the frontend platform used by millions of developers. You'll work on the dashboard, deployment flows, and developer experience.",
  },
  {
    company: "Linear",
    title: "Product Engineer",
    location: "Remote (Global)",
    workMode: "REMOTE" as const,
    status: "OFFER" as Status,
    priority: "HIGH" as const,
    source: "Referral",
    salaryMin: 170000,
    salaryMax: 200000,
    appliedAt: daysAgo(34),
    description:
      "Design and build features end to end. We look for engineers with strong product intuition and a high bar for craft.",
  },
  {
    company: "Stripe",
    title: "Software Engineer, Payments",
    location: "Seattle, WA",
    workMode: "HYBRID" as const,
    status: "SCREENING" as Status,
    priority: "MEDIUM" as const,
    source: "LinkedIn",
    salaryMin: 165000,
    salaryMax: 210000,
    appliedAt: daysAgo(12),
  },
  {
    company: "Notion",
    title: "Full Stack Engineer",
    location: "San Francisco, CA",
    workMode: "HYBRID" as const,
    status: "APPLIED" as Status,
    priority: "MEDIUM" as const,
    source: "Greenhouse",
    appliedAt: daysAgo(19),
  },
  {
    company: "Figma",
    title: "Frontend Engineer, Design Systems",
    location: "Remote (US)",
    workMode: "REMOTE" as const,
    status: "APPLIED" as Status,
    priority: "HIGH" as const,
    source: "LinkedIn",
    salaryMin: 175000,
    salaryMax: 205000,
    appliedAt: daysAgo(5),
  },
  {
    company: "Ramp",
    title: "Product Engineer",
    location: "New York, NY",
    workMode: "ONSITE" as const,
    status: "REJECTED" as Status,
    priority: "LOW" as const,
    source: "Wellfound",
    appliedAt: daysAgo(45),
  },
  {
    company: "Anthropic",
    title: "Frontend Engineer, Claude",
    location: "San Francisco, CA",
    workMode: "HYBRID" as const,
    status: "SAVED" as Status,
    priority: "HIGH" as const,
    source: "Company site",
    salaryMin: 200000,
    salaryMax: 260000,
  },
  {
    company: "Retool",
    title: "Senior Engineer, Platform",
    location: "Remote (US)",
    workMode: "REMOTE" as const,
    status: "SAVED" as Status,
    priority: "MEDIUM" as const,
    source: "Job board",
  },
];

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("Removed the previous demo account.");
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Alex Rivera",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
    },
  });

  const created: Application[] = [];
  for (const a of APPLICATIONS) {
    created.push(
      await prisma.application.create({
        data: {
          ...a,
          userId: user.id,
          events: { create: { to: a.status, note: "Application created" } },
        },
      }),
    );
  }

  const byCompany = (name: string) => created.find((a) => a.company === name)!;

  await prisma.interview.createMany({
    data: [
      {
        userId: user.id,
        applicationId: byCompany("Vercel").id,
        type: "TECHNICAL",
        scheduledAt: daysAhead(3),
        durationMins: 90,
        location: "Zoom",
        interviewers: "Dana Wu, Priya Shah",
        notes: "System design — focus on rendering pipelines and caching.",
      },
      {
        userId: user.id,
        applicationId: byCompany("Vercel").id,
        type: "PHONE_SCREEN",
        scheduledAt: daysAgo(9),
        durationMins: 30,
        outcome: "PASSED",
        interviewers: "Sam Ortiz",
      },
      {
        userId: user.id,
        applicationId: byCompany("Stripe").id,
        type: "PHONE_SCREEN",
        scheduledAt: daysAhead(6),
        durationMins: 45,
        location: "Google Meet",
        interviewers: "Jordan Blake",
      },
      {
        userId: user.id,
        applicationId: byCompany("Linear").id,
        type: "FINAL",
        scheduledAt: daysAgo(6),
        durationMins: 60,
        outcome: "PASSED",
        notes: "Went well — they mentioned an offer was likely.",
      },
    ],
  });

  await prisma.contact.createMany({
    data: [
      {
        userId: user.id,
        applicationId: byCompany("Vercel").id,
        name: "Dana Wu",
        title: "Technical Recruiter",
        email: "dana@example.com",
        notes: "Very responsive. Prefers email over LinkedIn.",
      },
      {
        userId: user.id,
        applicationId: byCompany("Linear").id,
        name: "Chris Patel",
        title: "Engineering Manager",
        email: "chris@example.com",
      },
      {
        userId: user.id,
        applicationId: byCompany("Stripe").id,
        name: "Jordan Blake",
        title: "Recruiting Coordinator",
        email: "jordan@example.com",
        phone: "(206) 555-0148",
      },
    ],
  });

  await prisma.reminder.createMany({
    data: [
      {
        userId: user.id,
        applicationId: byCompany("Notion").id,
        title: "Follow up — no response in 3 weeks",
        dueAt: daysAgo(2),
      },
      {
        userId: user.id,
        applicationId: byCompany("Linear").id,
        title: "Respond to the offer",
        dueAt: daysAhead(2),
      },
      {
        userId: user.id,
        applicationId: byCompany("Vercel").id,
        title: "Send thank-you note after the technical round",
        dueAt: daysAhead(4),
      },
      {
        userId: user.id,
        applicationId: byCompany("Anthropic").id,
        title: "Tailor resume and apply",
        dueAt: daysAhead(1),
      },
      {
        userId: user.id,
        title: "Update portfolio site",
        dueAt: daysAgo(5),
        done: true,
        completedAt: daysAgo(4),
      },
    ],
  });

  await prisma.note.createMany({
    data: [
      {
        applicationId: byCompany("Vercel").id,
        body: "Recruiter said the technical round is 90 minutes: 45 min system design, 45 min coding.",
      },
      {
        applicationId: byCompany("Linear").id,
        body: "Verbal offer: $195k base + equity. They want an answer by end of next week.",
      },
    ],
  });

  console.log(`Seeded ${created.length} applications for ${DEMO_EMAIL}`);
  console.log(`Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
