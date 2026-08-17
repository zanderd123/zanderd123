"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { headers } from "next/headers";

import { prisma } from "@/lib/db";
import { checkRateLimit, recordFailure, clearRateLimit } from "@/lib/rate-limit";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  isResetTokenLive,
} from "@/lib/password-reset";
import { getEmailSender, passwordResetEmail } from "@/lib/email";

/**
 * `values` echoes back what was submitted. React 19 resets an uncontrolled
 * form once its action resolves, so without this a failed login would wipe
 * the email the user already typed.
 */
export type AuthState = {
  error?: string;
  ok?: string;
  values?: { email?: string; name?: string };
} | null;

const signupSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const values = {
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
  };

  const parsed = signupSchema.safeParse({
    name: (formData.get("name") as string) || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, values };
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists.", values };
  }

  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash: await hashPassword(password) },
  });

  await createSession(user.id);
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** Identifies the caller for rate limiting: client IP plus the email tried. */
async function attemptKey(scope: string, email: string) {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    h.get("x-real-ip") ??
    "unknown";
  return `${scope}:${ip}:${email}`;
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const submittedEmail = String(formData.get("email") ?? "");
  const values = { email: submittedEmail };

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, values };
  }

  const { email, password } = parsed.data;
  const key = await attemptKey("login", email);

  const verdict = checkRateLimit(key);
  if (!verdict.allowed) {
    const mins = Math.ceil(verdict.retryAfterSec / 60);
    return {
      error: `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      values,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Same message either way so the form can't be used to enumerate accounts.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const nowBlocked = recordFailure(key);
    return {
      error: nowBlocked
        ? "Too many sign-in attempts. Try again in 15 minutes."
        : "Incorrect email or password.",
      values,
    };
  }

  clearRateLimit(key);
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

const NEUTRAL_RESET_MESSAGE =
  "If an account exists for that email, a reset link is on its way.";

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

/**
 * Always returns the same message whether or not the email is registered —
 * a different response here would let anyone check which emails have
 * accounts, which is exactly what a login form's "incorrect password"
 * message is designed to avoid.
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      values: { email: String(formData.get("email") ?? "") },
    };
  }

  const { email } = parsed.data;
  const key = await attemptKey("reset-request", email);

  const verdict = checkRateLimit(key);
  if (!verdict.allowed) {
    // Still neutral: revealing that *this specific* address is rate limited
    // would itself confirm the address is registered.
    return { error: NEUTRAL_RESET_MESSAGE };
  }
  recordFailure(key); // counts the attempt itself, not a failure to authenticate

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    // Any earlier unused link stops working once a new one is requested.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { raw, hash } = generateResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: resetTokenExpiry() },
    });

    const origin = (await headers()).get("origin") ?? "";
    const resetUrl = `${origin}/reset-password/${raw}`;
    const { subject, text, html } = passwordResetEmail(resetUrl);
    await getEmailSender().send({ to: email, subject, text, html });
  }

  return { ok: NEUTRAL_RESET_MESSAGE };
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function resetPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { token, password } = parsed.data;

  const key = await attemptKey("reset-consume", token.slice(0, 16));
  const verdict = checkRateLimit(key);
  if (!verdict.allowed) return { error: "Too many attempts. Request a new link." };

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });

  if (!record || !isResetTokenLive(record)) {
    recordFailure(key);
    return { error: "That reset link is invalid or has expired. Request a new one." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // A password reset is also the moment to end every other signed-in
    // session — if someone else's session was the reason a reset was
    // needed, this is what actually locks them out.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  clearRateLimit(key);
  await createSession(record.userId);
  redirect("/dashboard");
}
