"use client";

import { use, useActionState } from "react";
import Link from "next/link";

import { resetPassword, type ActionState } from "@/app/actions";

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [state, action] = useActionState<ActionState, FormData>(resetPassword, null);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="logo" style={{ padding: "0 0 18px" }}>
          <i>R</i>Redeploy
        </div>

        <form action={action} className="panel" style={{ padding: 20 }}>
          <h1 style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>
            Choose a new password
          </h1>
          <p className="sub2" style={{ marginBottom: 16 }}>
            This link works once and expires an hour after it was sent. Signing in with it
            ends every other session on your account.
          </p>

          {state?.error && (
            <p className="warn bad" style={{ marginBottom: 12 }}>
              {state.error}
            </p>
          )}

          <input type="hidden" name="token" value={token} />

          <div style={{ marginBottom: 16 }}>
            <label className="f" htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Reset password
          </button>

          <p className="sub2" style={{ marginTop: 14, textAlign: "center" }}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
