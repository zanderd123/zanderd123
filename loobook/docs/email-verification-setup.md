# Setting up email verification

The app side is done: after signing up with email, people get a 6-digit code and can't log in until they enter it. "Forgot password?" uses a code the same way. Apple and Google sign-ins skip this step, because those emails are already verified.

To make real emails go out, you need three things: a domain, an email-sending service, and the Supabase settings in this repo. This takes about an hour, plus some waiting for DNS changes to take effect.

## 1. Get a domain (about $10–$15 a year)

Buy one from a registrar such as Cloudflare, Namecheap or Porkbun, for example `loobook.app` once you've picked a name. Emails will come from an address on it, like `no-reply@loobook.app`.

Using a domain you own is what keeps the codes out of spam folders.

## 2. Sign up for an email-sending service

Supabase's built-in sender only delivers to your own team's addresses, a couple per hour, so it can't send to real users. Pick one of these:

| Service | Free tier | Notes |
|---|---|---|
| **Resend** | 3,000 emails/month | Easiest setup. `supabase/config.toml` is already filled in for it. |
| Postmark | 100/month | Best delivery rates; paid plans from $15/month. |
| Amazon SES | 3,000/month for 12 months, then about $0.10 per 1,000 | Cheapest at scale, fiddlier setup. |
| Brevo | 300/day | Good free tier. |

In the service:
1. Add your domain.
2. It will show 3–4 DNS records (SPF, DKIM, and usually DMARC). Copy each one into your domain registrar's DNS settings.
3. Wait until the service shows the domain as **Verified**. This usually takes minutes, but can take up to a day.
4. Create an **SMTP password** or **API key**. You'll paste it in step 3; don't put it in chat or in the code.

## 3. Turn it on in Supabase

Once your Supabase project exists:

1. Edit `loobook/supabase/config.toml`:
   - `site_url`: your website, e.g. `https://loobook.app`
   - `admin_email`: e.g. `no-reply@loobook.app`
   - `host`, `port`, `user`: from your email service (already set for Resend)
2. Copy `loobook/supabase/.env.example` to `loobook/supabase/.env` and paste your SMTP password into `SMTP_PASSWORD`. That file is ignored by git.
3. From the `loobook/` folder, run:
   ```
   supabase link --project-ref <your-project-ref>
   supabase config push
   ```
   This switches on "confirm email", the 6-digit code, the 60-second resend wait, the password rules, and the two email designs in `supabase/templates/`.

You can do the same by hand in the Supabase dashboard instead:
- **Authentication → Sign In / Providers → Email**: turn on *Confirm email*.
- **Authentication → Emails → SMTP Settings**: enter your email service's details.
- **Authentication → Emails → Templates**: paste in `templates/confirmation.html` and `templates/recovery.html`. The code only appears if the template contains `{{ .Token }}`.
- **Authentication → Policies** (or **Attack Protection**): minimum length 8, "Letters and digits".

## 4. Test it

1. In `loobook/app/.env.local`, set your Supabase URL and anon key (see the main README).
2. Run `npx expo start`, sign up with your own email, and check that the code arrives and works.
3. Try "Forgot password?" too.
4. If nothing arrives: check spam, then **Authentication → Logs** in Supabase and the logs in your email service.

## About the password rules

People need at least 8 characters, a letter, a number and a special character. The app shows a checklist that ticks off as they type.

- **Checked by Supabase:** the length, the letter and the number. These hold even if someone bypasses the app.
- **Checked only by the app:** the special character. Supabase can only require symbols if it also requires both uppercase and lowercase letters. If you want that stricter rule enforced by the server too, change `password_requirements` to `"lower_upper_letters_digits_symbols"` in `config.toml`, and I'll update the app's checklist to match.
- **Optional:** Supabase's Pro plan ($25/month) can reject passwords that have appeared in known data breaches (**Attack Protection → Leaked password protection**). It's worth switching on when you upgrade.
