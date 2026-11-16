# Getting LooBook into the App Store and Google Play

What each store requires, and where LooBook stands on it. ✅ = in the mockup, ⬜ = still to do.

## Accounts you need

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 / year | Enroll as an organization (needs a D-U-N-S number, free) so the store shows your company name rather than your personal name. |
| Google Play Console | $25 once | New personal accounts must run a closed test with at least 12 testers for 14 days before going public. An organization account skips that. |
| Domain + email | ~$15 / year | Needed for the privacy policy URL, support email and Sign in with Apple. |
| Business entity (LLC) | $50–$500 to form, plus a yearly fee in most states | Not required to publish. Recommended before launch: see "Do I need an LLC?" below. |
| AdMob account | free | Create the app there to get real ad unit IDs; add `app-ads.txt` to your website. |
| RevenueCat account | free until $2.5k/month in revenue | Runs the tip jar on both stores. |

## Apple App Store (App Review Guidelines)

| Requirement | Guideline | Status |
|---|---|---|
| **Sign in with Apple** if you offer Google sign-in | 4.8 | ✅ Both buttons on the login screen |
| Email sign-ups are verified before use | – | ✅ 6-digit code; ⬜ set up email sending ([guide](email-verification-setup.md)) |
| **Delete account inside the app** | 5.1.1(v) | ✅ Profile → Delete account |
| Privacy policy link in the app and on the store page | 5.1.1 | ✅ in app; ⬜ host it at a public URL |
| **User-generated content controls:** filter, report, block abusive users, publish contact info | 1.2 | ✅ Report button, guidelines, auto-hide after 3 reports, daily posting limit; ⬜ a "Block user" button (the database already supports it) and a word filter |
| Explain why you need location (permission text) | 5.1.1 | ✅ Primer screen and permission text in `app/app.json` |
| Only "When in use" location unless you truly need background | 5.1.1 | ✅ Foreground only |
| App works without location | 5.1.1 | ✅ Search by city, state, ZIP |
| Privacy "nutrition label" (App Privacy section) | – | ⬜ Declare: email, user ID, precise location (app functionality, not tracking), user content, purchase history (tips), device ID and advertising data (third-party advertising, used for tracking only if the person allows it) |
| Age rating questionnaire | – | ⬜ Likely 12+ because of unrestricted user content |
| Not a "web wrapper": must feel like a native app | 4.2 | ✅ Native app in `app/` (Expo / React Native) |
| Screenshots (6.7" and 6.5" iPhone), app icon 1024×1024 | – | ⬜ |
| **App Tracking Transparency** prompt before personalised ads | 5.1.2 | ✅ in `app/src/lib/monetization.ts` |
| **Tips go through in-app purchase**, not PayPal/Stripe links (only registered charities may link out) | 3.1.1 | ✅ consumable IAP via RevenueCat; ⬜ create the products in App Store Connect |
| Tips unlock nothing, and say so | 3.1.1 | ✅ "Tips are optional and don't unlock anything" |
| Ads are not shown on the map or in a way that's easy to tap by accident | 2.5.18 / 3.1 | ✅ one banner on the place sheet and profile only |

## Google Play

| Requirement | Status |
|---|---|
| Privacy policy URL | ⬜ host it |
| **Data safety form** (what data, why, encrypted, can users delete) | ⬜ same answers as Apple's label |
| **Account deletion**: in the app *and* a web page where people can request deletion without the app | ✅ in app and `web/delete-account.html`; ⬜ host the page |
| UGC policy: in-app reporting, moderation, terms that ban objectionable content | ✅ report + terms; ⬜ moderation queue |
| Location permission: foreground only, with an in-app explanation before the system prompt | ✅ |
| Target the latest Android API level | ⬜ handled by Expo SDK |
| Content rating (IARC questionnaire) | ⬜ |
| Feature graphic 1024×500, icon 512×512, phone screenshots | ⬜ |
| Tick "Contains ads" on the store listing | ⬜ |
| Advertising ID declaration (the ads SDK uses `AD_ID`) | ⬜ |
| Google consent form for EU/UK users before personalised ads | ✅ in the app; ⬜ create the GDPR message in AdMob → Privacy & messaging |
| Tips through Google Play Billing (consumable in-app products) | ✅ in the app; ⬜ create products in Play Console |

## Legal (have a lawyer review before launch)

- ✅ Draft [Terms of Service](../legal/terms-of-service.md), [Privacy Policy](../legal/privacy-policy.md), [Community Guidelines](../legal/community-guidelines.md). Fill in every `[BRACKET]`.
- ✅ Removal process for businesses: "Report a problem → I own this business", then a moderator sets `locked` on the place, which hides its code and blocks new ones. ⬜ Decide who checks these reports and how quickly.
- ⬜ Register a DMCA agent with the US Copyright Office ($6) for safe-harbour protection on user content.
- ✅ Worldwide: the Privacy Policy covers GDPR (EU/UK), legal bases, international transfers, and higher minimum ages where local law sets one.
- ⬜ The EU and UK may require you to name a representative there once you have users in those places (services exist for about $100–$300 a year).
- ⬜ Check the name "LooBook" for trademarks before buying the domain.

## Do I need an LLC?

**Not to publish.** Apple and Google both accept individual developers. The differences:

| | Individual | LLC |
|---|---|---|
| Store listing shows | your legal name | the company name |
| Apple sign-up needs | your Apple ID | a free D-U-N-S number (about a week) |
| Your personal savings if someone sues over a posted code | at risk | generally protected |
| Ad and tip income | on your personal taxes | on the business (usually still passes through to you) |
| Cost | $0 | about $50–$500 to form, plus a yearly state fee |

A US platform is largely protected from liability for what users post (Section 230), and the Terms and the removal process help. Because LooBook is built on user posts and businesses may object, forming an LLC before launch is a sensible, inexpensive step. Talk to a local accountant or lawyer; this is general information, not legal advice.
