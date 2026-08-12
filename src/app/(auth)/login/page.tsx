"use client";

import { useActionState } from "react";
import Link from "next/link";

import { login, type AuthState } from "@/app/actions/auth";
import { SubmitButton, ErrorText } from "@/components/ui";

export default function LoginPage() {
  const [state, formAction] = useActionState<AuthState, FormData>(login, null);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        TrackWise
      </Link>

      <div className="card p-6">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="muted mt-1 text-sm">Log in to pick up your search.</p>

        <form action={formAction} className="mt-6 space-y-4">
          <ErrorText>{state?.error}</ErrorText>

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              placeholder="••••••••"
            />
          </div>

          <SubmitButton className="btn-primary w-full" pendingText="Logging in…">
            Log in
          </SubmitButton>
        </form>
      </div>

      <p className="muted mt-6 text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-indigo-600 dark:text-indigo-400">
          Sign up
        </Link>
      </p>
    </div>
  );
}
