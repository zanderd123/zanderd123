// Deletes the signed-in person's account (Apple 5.1.1(v), Google Play account deletion).
// Their profile, votes, reports and blocks go with it (on delete cascade); codes they
// posted stay on the map with no name attached (on delete set null).
//
// For Sign in with Apple accounts, Apple also requires revoking the person's Apple
// tokens. The app sends a fresh authorization code from Apple; this function swaps it
// for a token and revokes it. That needs these secrets (supabase secrets set ...):
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 file's contents), APPLE_BUNDLE_ID
//
// Deploy: supabase functions deploy delete-account
import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Swaps an Apple authorization code for a refresh token and revokes it. */
async function revokeApple(authorizationCode: string): Promise<string | null> {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const privateKey = Deno.env.get("APPLE_PRIVATE_KEY");
  const clientId = Deno.env.get("APPLE_BUNDLE_ID");
  if (!teamId || !keyId || !privateKey || !clientId) return "Apple secrets are not set, so the Apple token was not revoked.";

  const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");
  const clientSecret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

  const form = (fields: Record<string, string>) =>
    ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

  const tokenRes = await fetch("https://appleid.apple.com/auth/token", form({
    client_id: clientId, client_secret: clientSecret, code: authorizationCode, grant_type: "authorization_code",
  }));
  if (!tokenRes.ok) return `Apple token exchange failed (${tokenRes.status}).`;
  const { refresh_token: refreshToken, access_token: accessToken } = await tokenRes.json();

  const revokeRes = await fetch("https://appleid.apple.com/auth/revoke", form({
    client_id: clientId, client_secret: clientSecret,
    token: refreshToken ?? accessToken, token_type_hint: refreshToken ? "refresh_token" : "access_token",
  }));
  return revokeRes.ok ? null : `Apple revoke failed (${revokeRes.status}).`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";

  // Who is asking? Use their own token, so nobody can delete someone else.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return Response.json({ error: "Not signed in." }, { status: 401, headers: cors });

  const body = await req.json().catch(() => ({}));
  const appleCode = typeof body?.apple_authorization_code === "string" ? body.apple_authorization_code : null;
  if (appleCode) {
    const problem = await revokeApple(appleCode).catch((e) => `Apple revoke error: ${e}`);
    // Still delete the account: the person asked for it. Log so it can be followed up.
    if (problem) console.error(`delete-account ${data.user.id}: ${problem}`);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const del = await admin.auth.admin.deleteUser(data.user.id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500, headers: cors });

  return Response.json({ deleted: true }, { headers: cors });
});
