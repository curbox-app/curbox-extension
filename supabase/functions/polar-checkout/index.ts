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
  if (userError || !user?.email) return json({ error: "invalid session" }, 401);

  const accessToken = Deno.env.get("POLAR_ACCESS_TOKEN");
  const productId = Deno.env.get("POLAR_PRODUCT_ID");
  if (!accessToken || !productId) return json({ error: "Polar billing is not configured" }, 503);

  const body = await req.json().catch(() => ({})) as { action?: string };
  const commonHeaders = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };

  if (body.action === "manage") {
    const returnUrl = Deno.env.get("POLAR_RETURN_URL");
    const response = await fetch("https://api.polar.sh/v1/customer-sessions", {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        external_customer_id: user.id,
        ...(returnUrl ? { return_url: returnUrl } : {}),
      }),
    });
    const result = await response.json().catch(() => ({})) as { customer_portal_url?: string; detail?: unknown };
    if (!response.ok || !result.customer_portal_url) {
      return json({ error: "could not open subscription management", detail: result.detail }, 502);
    }
    return json({ url: result.customer_portal_url });
  }

  const successUrl = Deno.env.get("POLAR_SUCCESS_URL");
  const returnUrl = Deno.env.get("POLAR_RETURN_URL");
  const response = await fetch("https://api.polar.sh/v1/checkouts", {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({
      products: [productId],
      external_customer_id: user.id,
      customer_email: user.email,
      metadata: { feature: "sync", plan: "yearly_25_usd" },
      ...(successUrl ? { success_url: successUrl } : {}),
      ...(returnUrl ? { return_url: returnUrl } : {}),
    }),
  });
  const result = await response.json().catch(() => ({})) as { url?: string; detail?: unknown };
  if (!response.ok || !result.url) {
    return json({ error: "could not start checkout", detail: result.detail }, 502);
  }
  return json({ url: result.url });
});
