import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { validateEvent, WebhookVerificationError } from "npm:@polar-sh/sdk@0.49.0/webhooks";

function response(status: number, message = ""): Response {
  return new Response(message, { status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response(405);
  const secret = Deno.env.get("POLAR_WEBHOOK_SECRET");
  const productId = Deno.env.get("POLAR_PRODUCT_ID");
  if (!secret || !productId) return response(503, "Polar billing is not configured");

  const rawBody = await req.text();
  let event: ReturnType<typeof validateEvent>;
  try {
    event = validateEvent(rawBody, Object.fromEntries(req.headers.entries()), secret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return response(403);
    console.error("Polar webhook parse failed", error);
    return response(400);
  }
  if (event.type !== "customer.state_changed") return response(202);

  const userId = event.data.externalId;
  if (!isUuid(userId)) return response(202);
  const eventId = req.headers.get("webhook-id") ?? `${event.type}:${event.timestamp.toISOString()}:${userId}`;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: handled } = await admin
    .from("billing_webhook_events")
    .select("event_id")
    .eq("provider", "polar")
    .eq("event_id", eventId)
    .maybeSingle();
  if (handled) return response(200);

  const subscriptions = event.data.activeSubscriptions
    .filter((subscription) => subscription.productId === productId)
    .sort((a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime());
  const active = subscriptions[0];

  if (!active) {
    const { error } = await admin
      .from("premium_entitlements")
      .update({ status: "revoked", valid_until: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", "polar");
    if (error) {
      console.error("Could not revoke Polar entitlement", error);
      return response(500);
    }
  } else {
    const { error } = await admin.from("premium_entitlements").upsert({
      user_id: userId,
      provider: "polar",
      status: active.status === "trialing" ? "trialing" : (active.cancelAtPeriodEnd ? "canceled" : "active"),
      valid_until: active.currentPeriodEnd.toISOString(),
      cancel_at_period_end: active.cancelAtPeriodEnd,
      provider_customer_id: event.data.id,
      provider_subscription_id: active.id,
      product_id: productId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });
    if (error) {
      console.error("Could not save Polar entitlement", error);
      return response(500);
    }
  }

  const { error: eventError } = await admin.from("billing_webhook_events").insert({
    provider: "polar",
    event_id: eventId,
    event_type: event.type,
  });
  if (eventError && eventError.code !== "23505") return response(500);
  return response(200);
});
