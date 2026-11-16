# Getting LooBook into the App Store and Google Play

What each store requires, and where LooBook stands on it. ✅ = in the mockup, ⬜ = still to do.

## Accounts you need

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 / year | Enroll as an organization (needs a D-U-N-S number, free) so the store shows your company name rather than your personal name. |
| Google Play Console | $25 once | New personal accounts must run a closed test with at least 12 testers for 14 days before going public. An organization account skips that. |
| Domain + email | ~$15 / year | Needed for the privacy policy URL, support email and Sign in with Apple. |
| Business entity (LLC) | varies by state | Recommended: user-generated content carries some legal risk. |

## Apple App Store (App Review Guidelines)

| Requirement | Guideline | Status |
|---|---|---|
| **Sign in with Apple** if you offer Google sign-in | 4.8 | ✅ Both buttons on the login screen |
| **Delete account inside the app** | 5.1.1(v) | ✅ Profile → Delete account |
| Privacy policy link in the app and on the store page | 5.1.1 | ✅ in app; ⬜ host it at a public URL |
| **User-generated content controls:** filter, report, block abusive users, publish contact info | 1.2 | ✅ Report button, guidelines; ⬜ "Block user" and a profanity filter on the server |
| Explain why you need location (permission text) | 5.1.1 | ✅ Primer screen; ⬜ `NSLocationWhenInUseUsageDescription` string |
| Only "When in use" location unless you truly need background | 5.1.1 | ✅ Foreground only |
| App works without location | 5.1.1 | ✅ Search by city, state, ZIP |
| Privacy "nutrition label" (App Privacy section) | – | ⬜ Declare: email, user ID, coarse + precise location (app functionality, not tracking), user content |
| Age rating questionnaire | – | ⬜ Likely 12+ because of unrestricted user content |
| Not a "web wrapper": must feel like a native app | 4.2 | ⬜ Build in React Native/Expo, not a website in a shell |
| Screenshots (6.7" and 6.5" iPhone), app icon 1024×1024 | – | ⬜ |

## Google Play

| Requirement | Status |
|---|---|
| Privacy policy URL | ⬜ host it |
| **Data safety form** (what data, why, encrypted, can users delete) | ⬜ same answers as Apple's label |
| **Account deletion**: in the app *and* a web page where people can request deletion without the app | ✅ in app; ⬜ web page |
| UGC policy: in-app reporting, moderation, terms that ban objectionable content | ✅ report + terms; ⬜ moderation queue |
| Location permission: foreground only, with an in-app explanation before the system prompt | ✅ |
| Target the latest Android API level | ⬜ handled by Expo SDK |
| Content rating (IARC questionnaire) | ⬜ |
| Feature graphic 1024×500, icon 512×512, phone screenshots | ⬜ |

## Legal (have a lawyer review before launch)

- ✅ Draft [Terms of Service](../legal/terms-of-service.md), [Privacy Policy](../legal/privacy-policy.md), [Community Guidelines](../legal/community-guidelines.md). Fill in every `[BRACKET]`.
- ⬜ A takedown process for businesses that want a code removed (promised in the Terms, section 9).
- ⬜ Register a DMCA agent with the US Copyright Office ($6) for safe-harbour protection on user content.
- ⬜ If you open to the EU/UK: GDPR basics (data export on request, a lawful basis for location).
- ⬜ Check the name "LooBook" for trademarks before buying the domain.
