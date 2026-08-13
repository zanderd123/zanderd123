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

export type AuthState = { error?: string } | null;

const signupSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    name: (formData.get("name") as string) || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists." };
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
async function attemptKey(email: string) {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    h.get("x-real-ip") ??
    "unknown";
  return `${ip}:${email}`;
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password } = parsed.data;
  const key = await attemptKey(email);

  const verdict = checkRateLimit(key);
  if (!verdict.allowed) {
    const mins = Math.ceil(verdict.retryAfterSec / 60);
    return {
      error: `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
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
