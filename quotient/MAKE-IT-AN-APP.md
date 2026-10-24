# Turning Quotient into an app

Quotient already works as an **installable web app**: `quotient/app/` has the
page, an app manifest, Peanut icons and a service worker so it opens offline.
What's left is putting it online, installing it on your phone, and, if you
want, listing it in the app stores.

There are three stages. Each one works on its own, so you can stop after any of them.

| Stage | What you get | Cost | Time |
|---|---|---|---|
| 1. Host it | A public web link anyone can open | Free | About 15 minutes |
| 2. Install it | An icon on your home screen that opens full screen and works offline | Free | 2 minutes per phone |
| 3. App stores | A listing in Google Play and/or the Apple App Store | $25 once (Google), $99 a year (Apple) | Days to weeks, mostly waiting on review |

---

## Stage 1: Put it online with GitHub Pages

1. **Merge the work into `main`.** Everything is on the branch
   `claude/bold-davinci-cedvn3`. Open a pull request from that branch into
   `main` on GitHub and merge it. Pages only publishes one branch, and `main` is the usual choice.
2. **Turn on Pages.** In the repository go to **Settings → Pages**. Under
   *Build and deployment* choose **Deploy from a branch**, pick `main` and
   `/ (root)`, and press **Save**.
3. **Wait a minute or two**, then open:
   **https://zanderd123.github.io/zanderd123/quotient/app/**
   The page at the bare `/zanderd123/` address is the repository's other
   project. Quotient lives under `/quotient/app/`.
4. **Updating it later:** change `quotient/quotient.html`, run
   `node quotient/build.mjs`, commit and push to `main`. Installed copies
   pick up the new version the next time they're opened online.

## Stage 2: Install it on your phone

**iPhone or iPad (Safari):** open the link, tap the **Share** button, then
**Add to Home Screen**, then **Add**.

**Android (Chrome):** open the link, tap the **⋮** menu, then **Install app**
(on some phones it says **Add to Home screen**).

**Computer (Chrome or Edge):** click the install icon at the right of the address bar.

After that, Quotient opens from its Peanut icon with no browser bars, and works without a connection.

> **Your progress:** the installed app saves progress on that device only.
> It doesn't share progress with the claude.ai version or with your other
> devices. Syncing would need an online account system (see *Later
> improvements*).

## Stage 3: The app stores

### Google Play (Android)

The simplest route is a **Trusted Web Activity**: a thin Android app that
shows your hosted site full screen. PWABuilder builds it for you.

1. Create a **Google Play Console** developer account (one-time $25 fee, plus ID verification).
2. Go to **pwabuilder.com**, paste your Stage 1 link and let it check the app.
   It reads the manifest and icons that are already in place.
3. Choose **Package for stores → Android**. Set the package ID, for example
   `com.zanderd123.quotient`, and download the bundle. **Keep the signing key
   it gives you safe.** You need the same key for every future update.
4. **Prove you own the site.** PWABuilder gives you an `assetlinks.json`
   file. It must be served from `/.well-known/assetlinks.json` at the **root of the domain**.
   A GitHub "project site" like `zanderd123.github.io/zanderd123/` can't serve
   the domain root, so do one of these:
   - create a second repository named exactly `zanderd123.github.io` and put the
     file at `.well-known/assetlinks.json` in it, or
   - put Quotient on your own domain (Pages supports custom domains).

   Without this step the app still works, but shows a browser address bar at the top.
5. In Play Console, create the app, upload the `.aab` file, and fill in the
   store listing: description, screenshots, the 512×512 icon from
   `quotient/app/icons/icon-512.png`, content rating, and a privacy policy link (see below).
6. **Testing requirement:** new personal developer accounts have to run a
   closed test with a group of testers for about two weeks before they can
   publish publicly. Check Play Console for the current numbers. Friends and
   family count.
7. Submit for review.

### Apple App Store (iPhone)

Apple doesn't accept web-wrapper packages like the Android one above, so the
app goes inside a native shell built with **Capacitor**. You need:
- a **Mac** with **Xcode** (free from the Mac App Store),
- the **Apple Developer Program** ($99 a year),
- **Node.js** installed on the Mac.

From the repository folder on the Mac:

```sh
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/ios
npx cap init Quotient com.zanderd123.quotient --web-dir quotient/app
npx cap add ios
node quotient/build.mjs && npx cap sync ios
npx cap open ios
```

Then, in Xcode:
1. Select the **App** target → **Signing & Capabilities** → choose your team.
2. Set the app icon: drag `quotient/app/icons/icon-1024.png` into
   **Assets → AppIcon**.
3. **Product → Archive**, then **Distribute App → App Store Connect**.
4. In **App Store Connect**: create the app record, add screenshots,
   description, privacy details and a privacy policy link, test it with
   **TestFlight**, then submit for review.

**Review tip:** Apple rejects apps that are "just a website" (guideline 4.2,
minimum functionality). Quotient works offline and is a full game, which helps.
Adding one native feature makes approval far more likely. The best fit is
**daily reminder notifications** using `@capacitor/local-notifications`
("Peanut's waiting with today's question!").

Capacitor can build the Android app too (`@capacitor/android`, then open in
Android Studio). Use it if you'd rather have one native project for both stores than the PWABuilder route.

### Before submitting to either store

- **Name:** search both stores for "Quotient". If it's taken, or close to an
  existing brand, pick a variant such as "Quotient: Brain Workout".
- **Privacy policy:** both stores require a public page. Quotient's is
  simple: progress is stored only on the device, there are no accounts, ads or
  tracking. One thing to mention: the fonts load from Google Fonts, which
  means Google sees the device's IP address when the fonts download. If you
  want to say "no third parties", copy the font files into `quotient/app/`
  and load them from there. You can host the policy as another page in the repository.
- **Screenshots:** take them from the installed app on a phone. The stores
  want specific sizes, which their upload pages list.
- **Claims:** describe Quotient as puzzles and brain games. Don't claim it
  raises IQ or prevents memory loss. App stores and advertising rules treat
  health claims strictly, and the Test tab already says its score is not an IQ.

---

## Later improvements

- **Daily reminders:** one push notification a day (needs the native shell from Stage 3).
- **Sync across devices:** an account system such as Supabase or Firebase
  to store progress online instead of only on the device.
- **Offline fonts:** bundle the two Google Fonts so nothing loads from outside the app.

## Files

    quotient/quotient.html        the app itself (also what the claude.ai version runs)
    quotient/build.mjs            node quotient/build.mjs -> rebuilds quotient/app/
    quotient/make-icons.mjs       node quotient/make-icons.mjs -> redraws the icons from Peanut
    quotient/app/                 the folder to host or wrap
      index.html                  page plus app metadata
      manifest.webmanifest        name, colours, icons
      sw.js                       offline support (regenerated by build.mjs)
      icons/                      192, 512, 1024, maskable 512, Apple touch and favicon
