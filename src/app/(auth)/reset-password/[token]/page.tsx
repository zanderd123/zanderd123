"use client";

import { useActionState } from "react";
import { use } from "react";
import Link from "next/link";

import { resetPassword, type AuthState } from "@/app/actions/auth";
import { SubmitButton, ErrorText } from "@/components/ui";

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [state, formAction] = useActionState<AuthState, FormData>(resetPassword, null);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        TrackWise
      </Link>

      <div className="card p-6">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <p className="muted mt-1 text-sm">This link works once and expires in an hour.</p>

        <form action={formAction} className="mt-6 space-y-4">
          <ErrorText>{state?.error}</ErrorText>
          <input type="hidden" name="token" value={token} />

          <div>
            <label className="label" htmlFor="password">
              New password
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

          <SubmitButton className="btn-primary w-full" pendingText="Saving…">
            Reset password
          </SubmitButton>
        </form>
      </div>

      <p className="muted mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-indigo-600 dark:text-indigo-400">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
