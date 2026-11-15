# Switching on Friends

Friends (friend codes, friend cards, the activity feed and cheers) runs on your
Supabase project. Everything is built; these steps connect it. Allow about 15
minutes.

Friends only appears in the **installed app** (`quotient/app`). The claude.ai
version cannot reach outside servers, so it never shows the Friends button.

## 1. Create the database tables

The whole database is one file: `supabase/migrations/20261115000000_quotient_social.sql`.
Use either way:

**A. Through the GitHub link you set up (automatic)**
1. Supabase dashboard → your project → **Project Settings → Integrations → GitHub**.
2. Repository `zanderd123/zanderd123`, Supabase directory `.` (the repository root),
   production branch `main`, and switch on **Deploy to production**.
3. Merge the `claude/bold-davinci-cedvn3` branch into `main`. Supabase applies the
   migration on the merge. Check **Database → Tables**: you should see `profiles`,
   `friendships`, `stats`, `events`, `cheers` and `reports`.

**B. By hand (works straight away)**
1. Supabase dashboard → **SQL Editor → New query**.
2. Paste the whole file, press **Run**. It should finish with "Success. No rows returned".

## 2. Send a 6-digit code instead of a link

The app signs people in with a code they type, which works inside a phone app.

1. **Authentication → Emails → Templates → Magic Link**.
2. Replace the body with something like:

   ```html
   <h2>Your Quotient sign-in code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
   ```
3. Save. (**Authentication → Sign In / Providers → Email** should be on; it is by default.)

**Before friends can sign in:** Supabase's built-in email sender only delivers to
members of your Supabase team and only a few emails an hour. For real users, add
your own sender under **Authentication → Emails → SMTP Settings**. Resend,
Postmark and Amazon SES all work; Resend's free tier is plenty to start.

## 3. Put your project's address into the app

1. **Project Settings → API** (on newer dashboards, **API Keys** and **Data API**).
2. Copy the **Project URL** (`https://xxxx.supabase.co`) and the **anon / publishable** key.
3. Paste them into `quotient/config.js`:

   ```js
   window.QUOTIENT_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJ…',
   };
   ```
4. Run `node quotient/build.mjs`, commit and push.

The anon key is designed to be public: it is shipped inside every Supabase app,
and the database's row-level security rules decide what each person can see. You
can paste it to Claude in a chat if you'd rather have it done for you. **Never**
share or ship the `service_role` key.

## 4. Try it

Open the installed app, tap **Friends**, sign in with your email and the code,
choose a name, and you'll get a friend code. Sign in on a second device (or a
second email) and add each other.

## What the database protects

`quotient/db-test/run.sh` runs the migration on a local Postgres and checks every
rule: strangers see nothing of each other; a pending request shows only a name;
stats and activity are visible only to accepted friends; the sharing switch hides
activity; blocks are invisible to the blocked person and stop new requests;
friendships can only change through the request functions; and deleting an
account removes all of its data.
