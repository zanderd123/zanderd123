# TrackWise

An applicant tracking system built for the person applying, not the company hiring.
Companies run an ATS to manage candidates; TrackWise gives job seekers the same
thing in reverse — every application, interview, contact, and follow-up in one
place instead of a spreadsheet and twelve browser tabs.

## What it does

- **Accounts** — email + password sign-up, hashed with bcrypt, httpOnly session cookies.
- **Applications** — full CRUD with company, role, location, work mode, salary range, source, priority, and the saved job description.
- **Pipeline board** — drag cards across Saved → Applied → Screening → Interview → Offer → Rejected. Moves save immediately and update optimistically.
- **Status timeline** — every status change is recorded per application, so you can see how a role progressed.
- **Interviews** — schedule rounds against the job they belong to, with type, duration, interviewers, location/link, prep notes, and outcome. Scheduling one automatically advances the application to Interview.
- **Contacts** — recruiters, hiring managers, and referrals, optionally linked to a specific application.
- **Reminders** — per-application or standalone follow-ups, with overdue highlighting.
- **Dashboard** — response rate, interview rate, offer count, upcoming interviews, open follow-ups, and a "gone quiet" list of live applications with no movement in 14+ days.
- **Paste-a-URL autofill** — paste a job posting link and TrackWise reads schema.org `JobPosting` JSON-LD (used by Greenhouse, Lever, Ashby, Workday and most boards), falling back to OpenGraph and `<title>` parsing. It only fills blank fields, never overwrites what you typed, and degrades to manual entry when a site blocks scraping.

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma · PostgreSQL

## Running locally

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run db:push               # create the tables
npm run db:seed               # optional: demo account with sample data
npm run dev
```

Open http://localhost:3000.

The seed creates a demo login:

```
demo@trackwise.app / demopassword
```

## Deploying

Works on any Node host. For Vercel + a hosted Postgres (Neon, Supabase, Railway):

1. Push this repo to GitHub and import it in Vercel.
2. Set `DATABASE_URL` to your connection string (include `?sslmode=require` for Neon).
3. Deploy — `npm run build` runs `prisma generate` first.
4. Run `npx prisma db push` once against the production database, or switch to
   `prisma migrate deploy` if you'd rather track migrations in git.

Sessions cookies are set `secure` automatically when `NODE_ENV=production`.

## Project layout

```
prisma/schema.prisma      data model
prisma/seed.ts            demo data
src/lib/auth.ts           password hashing, sessions, requireUser()
src/lib/parse-job.ts      job posting URL scraper
src/lib/statuses.ts       status vocabulary, labels, colors
src/app/actions/          server actions (auth, applications, interviews, contacts, reminders)
src/app/(auth)/           login, signup
src/app/(app)/            authenticated pages
src/components/           client components
```

Every query is scoped by `userId`, so one account can never read another's data —
requesting someone else's application returns 404.

## Not built yet

Two things from the original vision are deliberately left for a later pass: a live
job feed of current openings, and resume storage with per-application versioning and
keyword matching against a job description. The data model leaves room for both.
