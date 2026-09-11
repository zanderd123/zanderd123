"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type ActionState } from "@/app/actions";

export default function LoginPage() {
  const [state, action] = useActionState<ActionState, FormData>(login, null);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="logo" style={{ padding: "0 0 18px" }}>
          <i>R</i>Redeploy
        </div>

        <form action={action} className="panel" style={{ padding: 20 }}>
          <h1 style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>Sign in</h1>
          <p className="sub2" style={{ marginBottom: 16 }}>
            Retention console for healthcare staffing.
          </p>

          {state?.error && (
            <p className="warn bad" style={{ marginBottom: 12 }}>
              {state.error}
            </p>
          )}

          <div style={{ marginBottom: 12 }}>
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
          <div style={{ marginBottom: 16 }}>
            <label className="f" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            Sign in
          </button>

          <p className="sub2" style={{ marginTop: 12, textAlign: "center" }}>
            <Link href="/forgot-password">Forgot your password?</Link>
          </p>

          <p className="sub2" style={{ marginTop: 14 }}>
            Demo: <code>dana@northstar.example</code> / <code>demopassword</code>
          </p>
        </form>
      </div>
    </div>
  );
}
