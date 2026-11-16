# LooBook

A worldwide community map of restroom codes for restaurants, cafés and stores. Sign in, see red pins near you, tap one for the code and when it was added, and tap **+** to share a code you were given.

_"LooBook" is a working title. 100 alternatives are in [docs/names.md](docs/names.md)._

## Decisions so far

| Topic | Decision |
|---|---|
| Who can see codes | Signed-in members only. No anonymous browsing. |
| Businesses | Can ask for their code to be removed. Nothing else: no claiming, editing or posting. A removed location shows "Code removed" and blocks new codes. |
| Minimum age | 13, or higher where local law requires it |
| Where | Worldwide from day one. Distances show in miles or km to match the phone's settings. |
| Money | Optional tips through in-app purchase, plus a small banner ad on the place and profile screens (never on the map) |
| Anonymous posting | A checkbox when adding a code. Others see "Anonymous"; moderators can still see who posted it. Enforced by the database, not just the app. |
| Passwords | At least 8 characters with a letter, a number and a special character. A checklist shows as you type. |
| Email verification | Email sign-ups get a 6-digit code and can't log in until they enter it. Forgot password works the same way. Setup: [docs/email-verification-setup.md](docs/email-verification-setup.md) |

## What's here

```
loobook/
  app/                 the real iPhone + Android app (Expo / React Native, TypeScript)
  supabase/            backend: database, security rules, auth settings, email designs, account deletion
  legal/               Terms, Privacy Policy, Community Guidelines (drafts for a lawyer)
  web/                 account-deletion page Google Play requires
  docs/                store checklist, name ideas
  prototype/           the clickable web mockup from the first draft
```

## Try the app on your phone today (demo mode)

Demo mode runs on sample data with no backend. Any sign-in works, and sample places appear around wherever you are.

1. Install **Expo Go** from the App Store or Google Play.
2. On a computer with Node.js 20+:
   ```
   cd loobook/app
   npm install
   npx expo start
   ```
3. Scan the QR code with your phone's camera (iPhone) or with Expo Go (Android).

Expo Go can't run ads or tips, so those show placeholders. Everything else works: map, location, search, place details, add a code, report, profile, delete account.

## Connecting the real backend

1. Create a free project at supabase.com.
2. Install the Supabase CLI, then from `loobook/`:
   ```
   supabase link --project-ref <your-project-ref>
   supabase db push                         # creates the tables and security rules
   supabase functions deploy delete-account
   ```
3. Set up email sending, then run `supabase config push`. This turns on email verification, the password rules and the email designs. Steps: [docs/email-verification-setup.md](docs/email-verification-setup.md). Apple and Google sign-in keys go in `supabase/.env` (see `supabase/.env.example`).
4. Copy `app/.env.example` to `app/.env.local` and fill in the project URL and anon key.

## Building for the stores

Ads, tips and Sign in with Apple need a real build rather than Expo Go:

```
cd loobook/app
npx eas-cli@latest build --profile development   # a test build for your own phone
npx eas-cli@latest build --profile production    # the store build
npx eas-cli@latest submit                         # upload to App Store Connect / Play Console
```

Before production:
- Replace the Google test ad IDs in `app/app.json` with your AdMob app IDs, and set the banner IDs in `.env.local`.
- Create tip products (consumables, for example $0.99 / $2.99 / $4.99 / $9.99) in App Store Connect and Play Console. Add them to a RevenueCat offering named `tips` and put the RevenueCat keys in `.env.local`.
- Add a Google Maps Android API key in `app/app.json`.
- Change `com.loobook.app` to your own bundle ID once you pick a name.
- Work through [docs/app-store-checklist.md](docs/app-store-checklist.md).

## Checks

- `npm run typecheck` in `app/` passes.
- `npx expo export` bundles for iPhone and Android.
- Both database migrations were run against Postgres 16 with PostGIS. Tested:
  - members-only access, and people can only edit their own data
  - invalid codes are rejected and votes are counted
  - removed codes are hidden and new ones blocked
  - codes stay, without a name, after account deletion
  - anonymous codes show no name, and other members can't look up who posted them, even by querying the database directly
  - other people's votes are private, and blocking hides that person's codes
- Not yet run on a physical phone.

## Editing the legal text

Edit the files in `legal/`, then run `npm run legal` in `app/` to copy them into the app.
