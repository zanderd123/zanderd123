# LooBook

A community map of restroom codes for restaurants, cafés and stores. Open the map, see red pins near you, tap one for the code and when it was added, and tap **+** to share a code you were given.

_"LooBook" is a working title: a notebook (the design) for the loo (the subject). Easy to change._

## What's here

```
loobook/
  prototype/          clickable mockup (runs in any phone browser)
    src/app.html      screens and styles
    src/app.js        behaviour and sample data
    build.mjs         bundles everything into one file
    dist/index.html   open this on a phone
  legal/              draft Terms, Privacy Policy, Community Guidelines
  docs/               App Store / Google Play checklist
  backend/schema.sql  database design for Supabase
```

Build the prototype: `node loobook/prototype/build.mjs`, then open `loobook/prototype/dist/index.html`.

## The mockup covers

- **Welcome → sign up / log in** with Apple, Google or email, and a required "I agree to the Terms" box.
- **Location primer** that explains why before the phone asks (both stores expect this).
- **Map**: scroll anywhere on the globe. Red pins have a code; white pins are known places with no code yet; pale red pins are codes that may have changed.
- **Search bar** for city, state, ZIP code or place name.
- **"Closest code to you"** card, plus filters (has a code, added this week, food, stores).
- **Place sheet**: the code, when it was added, when it was last confirmed, who shared it, Worked / Didn't work buttons, older codes, Update code, Directions, Report.
- **+ button**: pick a nearby place or drop a pin, choose keypad / receipt / ask staff / no code, add a tip, confirm it's a public code.
- **Profile**: stats, location and notification settings, legal pages, sign out, **delete account**.

It's a prototype: sample places are made up, nothing is sent to a server, and the map shows hand-inked outlines instead of real streets when it runs inside Claude (real street tiles load when it's hosted normally).

## Suggested path to the real app

1. **App**: React Native with Expo. One codebase for iPhone and Android, and the screens above port over directly.
2. **Map**: Apple Maps on iPhone / Google Maps on Android via `react-native-maps`, or Mapbox for one custom black-and-white style on both.
3. **Places and search**: Google Places or Foursquare for business names and addresses, so people pick a real place instead of typing one.
4. **Backend**: Supabase (sign-in with Apple/Google/email, Postgres database, row-level security). The schema is in `backend/schema.sql`.
5. **Launch**: work through `docs/app-store-checklist.md`, have a lawyer review `legal/`, and run a TestFlight / Play closed test.
