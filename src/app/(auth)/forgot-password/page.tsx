"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestPasswordReset, type AuthState } from "@/app/actions/auth";
import { SubmitButton, ErrorText } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    null,
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        TrackWise
      </Link>

      <div className="card p-6">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="muted mt-1 text-sm">
          Enter the email on your account and we&apos;ll send a link to reset it.
        </p>

        {state?.ok ? (
          <p className="mt-6 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            {state.ok}
          </p>
        ) : (
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
                defaultValue={state?.values?.email ?? ""}
                className="input"
                placeholder="you@example.com"
              />
            </div>

            <SubmitButton className="btn-primary w-full" pendingText="Sending…">
              Send reset link
            </SubmitButton>
          </form>
        )}
      </div>

      <p className="muted mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-indigo-600 dark:text-indigo-400">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
