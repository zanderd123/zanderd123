# Redeploy

A retention console for travel healthcare staffing agencies.

Agencies already run an ATS. This is not another one — it sits beside it and
answers a question the ATS was never built to answer: **which travelers are
about to finish a contract with nothing lined up, and what does losing them
cost?**

## Why this exists

Nobody decides to lose a traveler. A contract runs down while the recruiter is
busy filling something else, and by the time anyone calls, the traveler has
signed with one of the other agencies they keep for exactly this reason. The end
date was visible the whole time — it just was not ranked, weighted by value, or
tied to the fact that nobody had spoken to them in three weeks.

## What it does

- **Redeployment board** — every active assignment ranked worst-first. Risk combines weeks remaining, recruiter silence, the answer on extending, and credentials about to lapse.
- **Margin at risk** — the 13-week value of every assignment ending soon with nothing secured. One number, on the dashboard.
- **Gone quiet** — travelers nobody has contacted recently, which is the leading indicator of the rest.
- **Compliance** — credentials expiring inside 30 days, ranked against the assignment they will block.
- **Margin** — gross margin per assignment, recruiter and facility, measured against the agency's floor.
- **Package builder** — build a package against a bill rate and watch margin move as you type, including the highest taxable rate that still clears the floor.
- **Settings** — margin floor, burden rate, and the gone-quiet threshold, each with a live preview of how a sample package would read before you save. Owner-only; everyone else sees the current values read-only.

## Getting data in

Nobody re-types anything. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

- **Bullhorn** — direct API sync. An agency can obtain OAuth credentials for its own tenant from Bullhorn support, so no partnership is needed to start. Housing and M&IE stipends live in agency-specific custom fields with no sensible default, so **Settings → Bullhorn field mapping** discovers the agency's real custom fields (labelled the way the agency named them, not as `customFloat3`) and lets the owner pick which two hold the stipends.
- **Anything else** — CSV import that upserts on external id, so a weekly re-export updates rather than duplicates.
- **VMS platforms are not required.** A VMS carries inbound job orders; this works on the book you have already placed, which lives in the ATS.

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind v4 · Prisma · PostgreSQL

## Running it

```bash
npm install
cp .env.example .env      # point DATABASE_URL at your Postgres
npm run db:push
npm run db:seed           # demo agency with a realistic book
npm run dev               # http://localhost:3100
```

Demo login: `dana@northstar.example` / `demopassword`

```bash
npm test                  # 32 assertions over margin, risk, import and Bullhorn field mapping
```

To exercise the Bullhorn sync and field-discovery flow locally against a fixture
server instead of the live API, set `BULLHORN_CLIENT_ID`/`SECRET` plus
`BULLHORN_AUTH_BASE`/`BULLHORN_REST_BASE` pointing at your own stand-in — those
two overrides exist for exactly this. `next start` bakes server env into the
build, so rebuild after changing them, not just restart.

## Multi-tenancy

Every model hangs off `Agency`, and every query is scoped by `agencyId` taken
from the session — never from a request parameter. A user cannot address another
agency's data even by guessing an id.

Roles: `OWNER` and `MANAGER` can edit pay packages and import; `RECRUITER` and
`COMPLIANCE` are read-plus-activity. Agency settings are `OWNER`-only — a
narrower gate than package edits, since the margin floor and burden rate
change how every deal in the agency reads, not just one.

## Layout

```
prisma/schema.prisma        agency-scoped data model
src/lib/economics.ts        pay package and margin maths (pure, tested)
src/lib/risk.ts             redeployment risk scoring (pure, tested)
src/lib/sources/            Bullhorn adapter, CSV parser, shared types
src/lib/ingest.ts           writes a normalised payload into one agency
src/lib/view.ts             one query for the book, everything derived in memory
src/app/(app)/              board, compliance, margin, builder, import
```

## Known gaps

- Rate limiting on sign-in is not yet ported over from the sibling app.
- Credential sync from Bullhorn is not implemented — it costs a call per candidate and needs an incremental job.
- No password reset.
- Redeploy is currently read-only against Bullhorn: contact logs and extension status live only here, not written back to Bullhorn's notes/activity feed.
