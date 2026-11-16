// Deletes the signed-in person's account (Apple 5.1.1(v), Google Play account deletion).
// Their profile, votes, reports and blocks go with it (on delete cascade); codes they
// posted stay on the map with no name attached (on delete set null).
//
// Deploy: supabase functions deploy delete-account
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";

  // Who is asking? Use their own token, so nobody can delete someone else.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return Response.json({ error: "Not signed in." }, { status: 401, headers: cors });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const del = await admin.auth.admin.deleteUser(data.user.id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500, headers: cors });

  return Response.json({ deleted: true }, { headers: cors });
});
