"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signup, type AuthState } from "@/app/actions/auth";
import { SubmitButton, ErrorText } from "@/components/ui";

export default function SignupPage() {
  const [state, formAction] = useActionState<AuthState, FormData>(signup, null);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        TrackWise
      </Link>

      <div className="card p-6">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="muted mt-1 text-sm">
          Start tracking your applications in under a minute.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <ErrorText>{state?.error}</ErrorText>

          <div>
            <label className="label" htmlFor="name">
              Name <span className="muted font-normal">(optional)</span>
            </label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              className="input"
              placeholder="Alex Rivera"
            />
          </div>

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
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
              placeholder="At least 8 characters"
            />
          </div>

          <SubmitButton className="btn-primary w-full" pendingText="Creating account…">
            Create account
          </SubmitButton>
        </form>
      </div>

      <p className="muted mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-indigo-600 dark:text-indigo-400">
          Log in
        </Link>
      </p>
    </div>
  );
}
