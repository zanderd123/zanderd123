# KIWI: making the verification emails send

_Saved on request. When the user says "KIWI", show them this._

The app already sends a 6-digit code at sign-up and for "Forgot password?". To make real emails go out (about an hour; full guide in `loobook/docs/email-verification-setup.md`):

1. **Buy a domain**, about $10–15 a year. Emails will come from an address on it, like `no-reply@yourname.app`, which keeps them out of spam.
2. **Sign up for an email-sending service.** Supabase's built-in sender only delivers to your own team, so it can't email real users. Recommended: **Resend** (free for 3,000 emails a month; the settings are already filled in for it in `loobook/supabase/config.toml`). The service gives you 3–4 settings to copy into your domain's DNS. Wait until it shows the domain as verified.
3. **Turn it on in Supabase.** Put the service's password in `loobook/supabase/.env` (copy `.env.example`; the file isn't saved to git) and run `supabase config push` from `loobook/`. That one command switches on email verification, the 6-digit codes, the password rules and the email designs.

Claude can do step 3 once the Supabase project exists, and can create the project too (Supabase is connected to the session).

Related open question: passwords currently need 8+ characters, a letter, a number and a special character. The special character is checked by the app only. To have Supabase enforce it as well, passwords would also need uppercase and lowercase letters (`password_requirements = "lower_upper_letters_digits_symbols"`).
