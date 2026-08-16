# Getting an agency's data in

The single biggest adoption risk for this product is asking a recruiter to type
an assignment into a second system. Nobody will. Everything below exists so that
never happens.

## The key distinction: ATS, not VMS

This trips people up, so it is worth stating plainly.

| | Holds | Does Redeploy need it? |
| --- | --- | --- |
| **VMS/MSP** (ShiftWise, Medefis, Vizient, Fieldglass, HealthTrust) | Inbound **job orders** from facilities — what is available to fill | **No** |
| **ATS** (Bullhorn, LaborEdge, Avionté, Crelate, JobDiva) | **Travelers, live assignments, pay packages, credentials, recruiter ownership** | **Yes** |

Redeploy is about the book you have *already placed* — who is on assignment, when
it ends, what it earns, and whether anyone has spoken to them. All of that lives
in the ATS. Job orders are a different problem.

This matters commercially: VMS integrations are negotiated per platform and are a
genuine barrier (there are companies whose entire business is aggregating them).
Not needing one is what makes this shippable.

## Bullhorn

Implemented in `src/lib/sources/bullhorn.ts`.

**Access model.** A Bullhorn customer can raise a support ticket and obtain OAuth
credentials for their own tenant. That means an agency can authorise Redeploy
without us being a Bullhorn partner — which is how the first customers get
onboarded. Listing on the Bullhorn Marketplace is what buys distribution and
partner keys later, and carries a validation fee (published at roughly
$1,000–$4,000 depending on scope).

**Auth flow.** OAuth 2.0 → access token → REST login → `BhRestToken`, then every
call goes to the tenant's own `restUrl` with that token.

**Rate limits to design against**, per a standard agreement:

- 50 concurrent API sessions
- 1,500 calls per minute
- 100,000 calls per month

That monthly budget is why `fetch()` pages through `query/Placement` with a field
mask rather than walking entities one at a time. Cache the session; do not log in
per request.

**Known gap.** Stipends (housing, M&IE) are not standard Bullhorn fields — every
agency keeps them in their own custom fields. The adapter deliberately returns
zero and emits a warning rather than guessing, because a wrong stipend produces a
wrong margin, which is worse than an obviously missing one. Field mapping belongs
in agency setup.

## Everything else

`src/lib/sources/csv.ts` is the universal fallback, and it is not a
second-class path — for a small agency it may be the only one they ever use.

- Handles quoted fields, embedded commas, `""` escapes, CRLF, and a BOM.
- Accepts `YYYY-MM-DD` and `MM/DD/YYYY`, anchored at midday so a timezone shift
  cannot move a date across a day boundary.
- Tolerates `$112` and `1,250` and `150k`; rejects anything else rather than
  coercing it to a wrong number.
- Bad rows are skipped with a line-numbered warning; good rows still import.
- Upserts on `external_id`, so re-importing the same weekly export updates rows
  instead of duplicating them.

## Adding a new source

Implement `DataSource` from `src/lib/sources/types.ts`, return a `SourcePayload`,
and hand it to `ingest()`. Nothing else in the app needs to change.

```ts
export class LaborEdgeSource implements DataSource {
  readonly key = "LABOREDGE";
  readonly label = "LaborEdge";
  isConfigured() { /* … */ }
  async fetch(): Promise<SourcePayload> { /* … */ }
}
```

`ingest()` is deliberately conservative about overwriting: anything a recruiter
has set inside Redeploy (extension status, next step, contact log) is only
replaced when the source supplies an explicit value, so a nightly sync never
wipes someone's notes.

## What is not built

- **Credential sync from Bullhorn.** Certifications live on separate entities and
  cost one call per candidate, which would blow the monthly budget on a large
  book. Needs a scheduled incremental job.
- **Webhooks.** Bullhorn supports REST webhook subscriptions; today this is
  pull-only, so data is as fresh as the last sync.
- **Field mapping UI.** Stipend custom-field mapping is currently a code change.
