import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "content-type": "application/json",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "sign in first" }, 401);

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) return json({ error: "invalid session" }, 401);

  const { data, error } = await client
    .from("premium_entitlements")
    .select("provider,status,valid_until,cancel_at_period_end,product_id,updated_at")
    .eq("user_id", user.id);
  if (error) return json({ error: "could not check premium access" }, 500);

  const now = Date.now();
  const activeStatuses = new Set(["active", "trialing", "grace_period", "canceled"]);
  const active = (data ?? [])
    .filter((row) => activeStatuses.has(row.status) && (!row.valid_until || Date.parse(row.valid_until) > now))
    .sort((a, b) => Date.parse(b.valid_until ?? "9999-12-31") - Date.parse(a.valid_until ?? "9999-12-31"));

  return json({
    entitled: active.length > 0,
    provider: active[0]?.provider ?? null,
    validUntil: active[0]?.valid_until ?? null,
    cancelAtPeriodEnd: active[0]?.cancel_at_period_end ?? false,
    price: "$25",
  });
});
