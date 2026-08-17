# TrackWise

An applicant tracking system built for the person applying, not the company hiring.
Companies run an ATS to manage candidates; TrackWise gives job seekers the same
thing in reverse — every application, interview, contact, and follow-up in one
place instead of a spreadsheet and twelve browser tabs.

## What it does

- **Accounts** — email + password sign-up, hashed with bcrypt, httpOnly session cookies, and a full password-reset flow.
- **Applications** — full CRUD with company, role, location, work mode, salary range, source, priority, and the saved job description.
- **Pipeline board** — drag cards across Saved → Applied → Screening → Interview → Offer → Rejected. Moves save immediately and update optimistically.
- **Status timeline** — every status change is recorded per application, so you can see how a role progressed.
- **Interviews** — schedule rounds against the job they belong to, with type, duration, interviewers, location/link, prep notes, and outcome. Scheduling one automatically advances the application to Interview.
- **Contacts** — recruiters, hiring managers, and referrals, optionally linked to a specific application.
- **Reminders** — per-application or standalone follow-ups, with overdue highlighting.
- **Dashboard** — response rate, interview rate, offer count, upcoming interviews, open follow-ups, and a "gone quiet" list of live applications with no movement in 14+ days.
- **Paste-a-URL autofill** — paste a job posting link and TrackWise fills in the company, title, location, description, and salary where it can. It only fills blank fields, never overwrites what you typed, and degrades to manual entry when a site blocks automated requests.

  It reads each source in order of reliability:

  | Source | How it's read |
  | --- | --- |
  | Greenhouse | `boards-api.greenhouse.io` — job + board endpoints (the board gives the correctly spelled company name) |
  | Lever | `api.lever.co` posting API, including the split description/lists/additional fields |
  | Ashby | `api.ashbyhq.com` public job board, including the salary band |
  | Workday | the tenant's own CXS JSON endpoint, same origin as the posting |
  | Everything else | schema.org `JobPosting` JSON-LD, then OpenGraph, then `<title>` |

  The four named platforms render their postings client-side and return 403 to
  scrapers, so reading their APIs is the only way to get real data out of them.

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma · PostgreSQL

## Running locally

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run db:push               # create the tables
npm run db:seed               # optional: demo account with sample data
npm run dev
npm test                      # 10 assertions over the reset-token logic
```

Open http://localhost:3000.

The seed creates a demo login:

```
demo@trackwise.app / demopassword
```

### Email

Password resets need to send mail. With no provider configured, messages are
written to `.dev-outbox/emails.jsonl` instead of being sent — so nothing can
email a real address before you deliberately set one up, and you can read the
reset link straight out of that file while developing.

To send for real, set `RESEND_API_KEY` and `EMAIL_FROM`. Swapping provider means
implementing `EmailSender` in `src/lib/email.ts`; nothing else changes.


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
src/lib/password-reset.ts reset-token generation and verification (pure, tested)
src/lib/email.ts          pluggable email sender; writes to a file in dev
src/lib/parse-job.ts      job posting URL scraper
src/lib/statuses.ts       status vocabulary, labels, colors
src/app/actions/          server actions (auth, applications, interviews, contacts, reminders)
src/app/(auth)/           login, signup
src/app/(app)/            authenticated pages
src/components/           client components
```

## Security

- Every query is scoped by `userId`, so one account can never read another's data — requesting someone else's application returns 404.
- Passwords are bcrypt-hashed (cost 12); sessions are opaque tokens in httpOnly, SameSite=Lax cookies, marked `secure` in production.
- Sign-in is rate limited to 8 attempts per IP + email per 15 minutes. The counter lives in process memory, so it resets on deploy and is per-instance — move it to Postgres or Redis before running several instances behind a load balancer.
- The job-posting importer fetches user-supplied URLs, so it runs behind an SSRF guard (`src/lib/safe-fetch.ts`): hostnames are resolved and checked against loopback, private, link-local, and CGNAT ranges before connecting, and redirects are followed by hand so every hop is re-checked. This is what stops a pasted `http://169.254.169.254/` from reading cloud metadata back through the form.
- Only `http(s)` URLs can be stored on an application, so a saved link is always safe to render as an href.
- Password reset links are single-use, expire after an hour, and are stored **hashed** — the raw token exists only in the emailed URL, so a database read alone can never produce a working link. Requesting a new link invalidates any earlier one, and completing a reset signs out every other active session.
- The reset form returns an identical message whether or not the email is registered, so it can't be used to discover which addresses have accounts.

## Not built yet

Email verification on sign-up is still missing, as is a settings screen. The
in-process rate limiter still resets on deploy and counts per instance.

Two things from the original vision are deliberately left for a later pass: a live
job feed of current openings, and resume storage with per-application versioning and
keyword matching against a job description. The data model leaves room for both.
