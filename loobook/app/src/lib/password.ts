/**
 * Password rules, shown as a live checklist while typing.
 * Keep in step with Supabase → Authentication → Policies (see supabase/config.toml):
 * minimum length 8, "letters and digits" required on the server. The special
 * character rule is enforced here in the app.
 */
// Supabase's "letters and digits" check looks for a-z / A-Z and 0-9, so match it exactly.

export const PASSWORD_RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "letter", label: "A letter (a–z)", test: (p) => /[A-Za-z]/.test(p) },
  { id: "number", label: "A number", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "A special character, like ! @ # $ ?", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export const passwordOk = (p: string) => PASSWORD_RULES.every((r) => r.test(p));

export function passwordProblem(p: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.label.toLowerCase());
  return missing.length ? `Your password needs ${missing.join(", ")}.` : null;
}
