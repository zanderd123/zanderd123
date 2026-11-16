# Getting Quotient into the App Store and Google Play

This is the checklist from where the project is now to a live listing in both
stores, in order. Tick each box as you go. Steps marked **(you)** need your
accounts, money or a Mac. Everything else is already built into the repository.

**What's already done**
- The app: `quotient/quotient.html`, built into `quotient/app/` with `node quotient/build.mjs`.
- Accounts: create an account (email + password, 13+ and Terms checkbox), log in,
  email-code login and forgotten password, change password, cloud backup of
  progress, sign out, and delete account inside the app.
- Terms of Use and Privacy Policy: `quotient/legal/terms.html` and `privacy.html`,
  shown inside the app and copied into `quotient/app/`.
- Native projects: `quotient-mobile/` (Capacitor 8.6) with `ios/` and `android/`
  folders, Peanut app icons and splash screens, and a daily reminder notification.
- The database: `supabase/migrations/` (profiles, friends, stats, activity,
  reports, cloud saves) with row-level security, tested in `quotient/db-test/`.

Rough costs: Apple Developer Program **$99/year**, Google Play **$25 once**.
Supabase and an email sender are free at the start. Allow 2–4 weeks in total,
mostly waiting: Google's closed test alone takes 14 days.

---

## Part A: Finish the backend (about 30 minutes)

### A1. Create the database tables (you)
Supabase dashboard → your project → **SQL Editor → New query**. Paste and **Run**
each file in `supabase/migrations/`, oldest first:
1. `20261115000000_quotient_social.sql`
2. `20261116000000_quotient_accounts.sql`

Each should say "Success. No rows returned". (Or use the GitHub integration in
`FRIENDS-SETUP.md`, which applies them when the branch is merged to `main`.)

### A2. Turn on email + password sign-in (you)
**Authentication → Sign In / Providers → Email**:
- **Enable Email provider**: on
- **Confirm email**: on (new accounts confirm their address with a 6-digit code)
- **Minimum password length**: 8
- Optional, recommended: **Prevent use of leaked passwords**

### A3. Make the emails send a code, not a link (you)
**Authentication → Emails → Templates**. Edit both:
- **Confirm signup**
  ```html
  <h2>Welcome to Quotient!</h2>
  <p>Your confirmation code is <strong>{{ .Token }}</strong></p>
  <p>Enter it in the app to finish creating your account.</p>
  ```
- **Magic Link** (used by "Email me a code" and forgotten passwords)
  ```html
  <h2>Your Quotient sign-in code</h2>
  <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
  <p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
  ```

### A4. Add a real email sender (you)
Supabase's built-in sender only reaches your own team, a few emails an hour. Sign
up for **Resend** (free tier), verify a domain you own, create an SMTP
password, then **Authentication → Emails → SMTP Settings** → enable custom SMTP
and fill in host `smtp.resend.com`, port `465`, user `resend`, and the password.
*If you have no domain yet, buy one (about $10/year). You will want it for a
support email and website anyway.*

### A5. Put the project address in the app
**Project Settings → API**: copy the **Project URL** and the **anon / publishable**
key into `quotient/config.js`, or paste them to Claude in chat and ask for it to
be done. The anon key is meant to be public. **Never** share the `service_role` key.

### A6. Try it
`node quotient/build.mjs`, open the installed app or `quotient/app/index.html` from
a local server, tap **Sign in → Create account**, get the code by email, and
check the Account panel shows "progress backed up".

---

## Part B: Fill in the legal pages (15 minutes)

### B1. Replace the placeholders (you)
In `quotient/legal/terms.html` and `privacy.html`, replace every highlighted
`[DEVELOPER NAME]`, `[CONTACT EMAIL]`, `[STATE / COUNTRY]`, `[SUPABASE REGION]`
and `[e.g. Resend]`. Your Supabase region is under **Project Settings → General**.
Then run `node quotient/build.mjs`.

> These pages are a solid starting draft written for this app as it works today,
> **not legal advice**. If you plan to charge money, collect more data, or
> target children, have a lawyer review them. If you change what data the app
> collects, update the Privacy Policy and bump its version date, and bump
> `TERMS_VERSION` in `quotient.html` if the Terms change.

### B2. Publish them on the web
Both stores need a public **Privacy Policy URL** (Apple also asks for a
**Support URL**). Merge the branch to `main` and turn on GitHub Pages
(`MAKE-IT-AN-APP.md`, Stage 1). They will then be at:
- https://zanderd123.github.io/zanderd123/quotient/app/privacy.html
- https://zanderd123.github.io/zanderd123/quotient/app/terms.html

For the Support URL, the Terms page works (it has your contact email), or make a
simple page.

---

## Part C: Developer accounts (start now, they take days)

### C1. Apple (you)
1. Make sure your Apple ID has **two-factor authentication** on.
2. Enrol at **developer.apple.com/programs** ($99/year). As an individual, the
   seller name on the store is your legal name; to show a business name you
   need an organisation enrolment with a D-U-N-S number (free, but takes about a week).
3. Approval usually takes 1–2 days.

### C2. Google (you)
1. Create a **Google Play Console** account at **play.google.com/console** ($25).
2. Complete identity verification (ID document, and a phone number on the account).
3. Personal accounts must run a **closed test with at least 12 testers for 14
   days in a row** before they can publish publicly. Line up 12+ friends with
   Android phones now (their Gmail addresses go on the tester list).

---

## Part D: Build the apps

You need a **Mac with Xcode** for iPhone. Android can be built on any computer
with **Android Studio**. Install **Node.js 22 or newer** on that computer, then
clone the repository and:

```sh
cd quotient-mobile
npm install
npm run sync        # rebuilds quotient/app and copies it into both native projects
```

Run `npm run sync` again after **every** change to `quotient.html`, `config.js` or
the legal pages.

### D1. iPhone (you, on a Mac)
1. `npm run ios`. Xcode opens the project.
2. Click **App** in the left sidebar → target **App** → **Signing & Capabilities**
   → tick *Automatically manage signing* → choose your **Team**. The Bundle
   Identifier is `com.zanderd123.quotient`. Change it if you like, but it can
   never change after the first upload.
3. **General** tab: Display Name `Quotient`, Version `1.0.0`, Build `1`. Set
   *Supported Destinations* to iPhone only (unless you want to test iPad layouts too).
4. Plug in your iPhone, choose it at the top, press **▶ Run**. Try everything,
   including creating an account and turning on the daily reminder (Progress tab).
5. **Product → Archive**, then **Distribute App → App Store Connect → Upload**.

### D2. Android (you)
1. `npm run android`. Android Studio opens the project; let Gradle finish.
2. Run it on a phone or emulator with **▶** and try everything.
3. **Build → Generate Signed App Bundle or APK → Android App Bundle** → *Create
   new* key store. **Back up the .jks file and both passwords somewhere safe.**
   Without them you can never update the app. (Play App Signing, which is on by
   default, also keeps a copy of the app signing key on Google's side.)
4. Choose **release** and finish. The `.aab` file is in `android/app/release/`.
5. Each new upload needs a higher **versionCode** in `android/app/build.gradle`
   (1, 2, 3…), and on iOS a higher **Build** number.

---

## Part E: The reviewer demo account

Both stores need to sign in to test the Friends features.
1. In the app, **Create account** with an address you control, for example
   `quotient.review@yourdomain.com`, and a strong password.
2. Pick a display name like *App Review*. Add a second test account as a friend
   so the reviewer sees friend cards and activity.
3. You will paste this email and password into **App Review Information** (Apple)
   and **App access** (Google). Keep the account alive. If it's deleted, the
   review is rejected.

---

## Part F: Store listings

### F1. Things you'll need for both
| Item | Notes |
|---|---|
| Name | "Quotient" may be taken; have a backup such as "Quotient: Daily Brain Workout" (Apple: 30 characters) |
| Subtitle / short description | e.g. "Daily puzzles, memory and focus games" (Apple 30, Google 80 chars) |
| Description | What's in it: Question of the Day, 5-round workout, 9 games, Daily Grid, Challenge of the Day, Puzzle Vault, Word of the Day, friends. Say "brain games and puzzles". **Don't** claim it raises IQ, improves memory or treats anything |
| Keywords (Apple) | puzzle, logic, brain, memory, daily, word, riddle, focus, maths |
| Category | Primary **Games → Puzzle** (or **Education**); secondary **Education** / **Trivia** |
| Icon | `quotient/app/icons/icon-1024.png` (Apple, inside the build); `icon-512.png` (Google listing) |
| Screenshots | iPhone 6.9" (1320×2868 or 1290×2796) at least 3; Android phone at least 2. Take them in the simulator/emulator or on your phone: Today, a game, the Puzzle Vault, Progress, Friends |
| Feature graphic (Google) | 1024×500 image, Peanut + name on the sky blue |
| Privacy Policy URL | from B2 |
| Support URL (Apple) | from B2 |
| Age rating | answer the questionnaires honestly; the friends feature counts as user interaction. Expect **9+ / 12+ (Apple)** and **Everyone / Teen (Google)** |
| Price | Free |

### F2. Apple: App Store Connect (you)
1. **appstoreconnect.apple.com → Apps → +** → New App: iOS, name, language,
   bundle ID `com.zanderd123.quotient`, SKU `quotient-ios`.
2. **App Privacy → Get Started**: *Yes, we collect data*. Select:
   - **Contact Info → Email Address**: App Functionality · Linked to user · Not used for tracking
   - **User Content → Other User Content** (display name, reports): App Functionality · Linked · No tracking
   - **Identifiers → User ID**: App Functionality · Linked · No tracking
   - **Usage Data → Product Interaction** *(or Other Data → gameplay)*: App Functionality · Linked · No tracking
3. **Age Rating** questionnaire.
4. **TestFlight**: once your upload from D1 finishes processing (10–30 min),
   install it with the TestFlight app and test it on a real phone.
5. Version page: screenshots, description, keywords, support URL, select the build.
6. **App Review Information**: the demo account from Part E, and a note:
   > Sign in from the "Sign in" button at the top. Friends lets players add each
   > other by friend code. Each friend card has Block and Report; reports go to
   > our moderation table and are reviewed within 24 hours. Account deletion is
   > in Friends → Account → Delete my account. The daily reminder is on the
   > Progress tab.
7. **Submit for Review**. Usually 1–3 days.

### F3. Google: Play Console (you)
1. **Create app**: name, default language, *Game*, *Free*, accept the declarations.
2. **App content** (left menu, under *Policy*), complete every item:
   - **Privacy policy** URL
   - **App access**: *All or some functionality is restricted* → add the demo login
   - **Ads**: No
   - **Content rating** questionnaire
   - **Target audience**: 13+ (choose 13–15, 16–17, 18+). Don't include under-13s; that brings the Families policy
   - **Data safety**: collects **Email address**, **User IDs**, **Name** (display name),
     **App interactions / In-app activity** (gameplay). All: collected, not
     shared, processed for **App functionality** and **Account management**,
     encrypted in transit, users **can request deletion**. Also give the web
     address for account deletion: use the Privacy Policy URL (section 6 explains it)
   - **Account deletion**: deletion is in-app and the URL above
3. **Store listing**: short and full description, icon, feature graphic, screenshots.
4. **Testing → Closed testing → Create track**: upload the `.aab`, add your 12+
   testers' emails, send them the opt-in link. They must stay opted in **14 days**.
5. After 14 days: **Apply for production** in the dashboard, answer the questions
   about your test, then create a **Production** release with the same `.aab`
   (or a newer one) and **Send for review**. Usually a few days.

---

## Part G: After launch

- **Check reports** weekly: Supabase → Table Editor → `reports`. Act on them
  within 24 hours (Apple expects it). To ban someone, delete their user under
  **Authentication → Users**.
- **Updating**: edit, `node quotient/build.mjs`, `cd quotient-mobile && npm run sync`,
  raise the version/build numbers, upload, submit. (The web version updates by
  pushing to `main`.)
- **Supabase free tier** pauses a project after a week with no activity. Once
  real people use the app this won't happen, but during review it can. Open the
  dashboard before submitting, or upgrade to Pro ($25/month) when you launch.
- **Back up** your Android key store and passwords, and your Apple account login.

## Common rejection reasons, and how Quotient handles them

| Reason | Status |
|---|---|
| Account deletion not in app (Apple 5.1.1(v), Google) | Friends → Account → Delete my account |
| User content without block/report (Apple 1.2) | Block and Report on every friend card; Terms forbid abuse |
| "Just a website" (Apple 4.2) | Works fully offline from files inside the app, plus native daily reminders |
| Reviewer can't sign in | Demo account in Part E; make sure custom SMTP (A4) works |
| Health or IQ claims (Apple 1.4.1) | Test tab says its score is not an IQ; keep the listing text to "puzzles and brain games" |
| Sign in with Apple required (4.8) | Not needed: Quotient uses its own email accounts, no Google/Facebook login |
| Privacy labels don't match | Use the lists in F2 / F3; they match `privacy.html` |
