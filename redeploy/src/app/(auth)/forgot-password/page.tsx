"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestPasswordReset, type ActionState } from "@/app/actions";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState<ActionState, FormData>(requestPasswordReset, null);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="logo" style={{ padding: "0 0 18px" }}>
          <i>R</i>Redeploy
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <h1 style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>Reset your password</h1>
          <p className="sub2" style={{ marginBottom: 16 }}>
            Enter the email on your account and we&apos;ll send a link to reset it.
          </p>

          {state?.ok ? (
            <p className="warn ok">{state.ok}</p>
          ) : (
            <form action={action}>
              {state?.error && (
                <p className="warn bad" style={{ marginBottom: 12 }}>
                  {state.error}
                </p>
              )}

              <div style={{ marginBottom: 16 }}>
                <label className="f" htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  defaultValue={state?.values?.email ?? ""}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                Send reset link
              </button>
            </form>
          )}

          <p className="sub2" style={{ marginTop: 14, textAlign: "center" }}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
