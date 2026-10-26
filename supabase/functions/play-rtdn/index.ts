import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

async function googleAccessToken(serviceAccount: { client_email: string; private_key: string; token_uri?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string };
  if (!response.ok || !result.access_token) throw new Error("Google authentication failed");
  return result.access_token;
}

async function validPubSubCaller(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const audience = Deno.env.get("GOOGLE_PLAY_RTDN_AUDIENCE");
  const expectedEmail = Deno.env.get("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL");
  if (!bearer || !audience || !expectedEmail) return false;
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer)}`);
  if (!response.ok) return false;
  const claims = await response.json() as { aud?: string; email?: string; email_verified?: string | boolean };
  return claims.aud === audience && claims.email === expectedEmail && String(claims.email_verified) === "true";
}

type PushBody = {
  message?: { data?: string; messageId?: string };
};

type DeveloperNotification = {
  packageName?: string;
  subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string; notificationType?: number };
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  if (!await validPubSubCaller(req)) return new Response("", { status: 403 });

  const rawServiceAccount = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const packageName = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") ?? "neth.iecal.curbox";
  const productId = Deno.env.get("GOOGLE_PLAY_PRODUCT_ID") ?? "curbox_sync";
  if (!rawServiceAccount) return new Response("", { status: 503 });

  try {
    const body = await req.json() as PushBody;
    const eventId = body.message?.messageId;
    const encoded = body.message?.data;
    if (!eventId || !encoded) return new Response("", { status: 400 });
    const notification = JSON.parse(atob(encoded)) as DeveloperNotification;
    const purchaseToken = notification.subscriptionNotification?.purchaseToken;
    if (notification.packageName !== packageName || !purchaseToken) return new Response("", { status: 202 });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: handled } = await admin
      .from("billing_webhook_events")
      .select("event_id")
      .eq("provider", "google_play")
      .eq("event_id", eventId)
      .maybeSingle();
    if (handled) return new Response("", { status: 200 });

    const purchaseHash = await sha256(purchaseToken);
    const { data: mapping, error: mappingError } = await admin
      .from("billing_purchases")
      .select("user_id")
      .eq("provider", "google_play")
      .eq("purchase_token_hash", purchaseHash)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping) {
      // The client may still be sending the new token to play-verify. Ask
      // Pub/Sub to retry instead of permanently dropping the first event.
      return new Response("", { status: 503 });
    }

    const serviceAccount = JSON.parse(rawServiceAccount) as { client_email: string; private_key: string; token_uri?: string };
    const accessToken = await googleAccessToken(serviceAccount);
    const purchaseResponse = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!purchaseResponse.ok) throw new Error("Google Play verification failed");
    const purchase = await purchaseResponse.json() as {
      subscriptionState?: string;
      lineItems?: Array<{ productId?: string; expiryTime?: string }>;
    };
    const validUntilMs = Math.max(
      ...(purchase.lineItems ?? [])
        .filter((item) => item.productId === productId && item.expiryTime)
        .map((item) => Date.parse(item.expiryTime!)),
      0,
    );
    const activeStates = new Set([
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_CANCELED",
    ]);
    const active = activeStates.has(purchase.subscriptionState ?? "") && validUntilMs > Date.now();
    const status = !active
      ? (purchase.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED" ? "expired" : "revoked")
      : purchase.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      ? "grace_period"
      : purchase.subscriptionState === "SUBSCRIPTION_STATE_CANCELED"
      ? "canceled"
      : "active";
    const now = new Date().toISOString();
    const { error } = await admin.from("premium_entitlements").upsert({
      user_id: mapping.user_id,
      provider: "google_play",
      status,
      valid_until: active ? new Date(validUntilMs).toISOString() : now,
      cancel_at_period_end: status === "canceled",
      provider_subscription_id: purchaseHash,
      product_id: productId,
      updated_at: now,
    }, { onConflict: "user_id,provider" });
    if (error) throw error;
    const { error: eventError } = await admin.from("billing_webhook_events").insert({
      provider: "google_play",
      event_id: eventId,
      event_type: `subscription.${notification.subscriptionNotification?.notificationType ?? "unknown"}`,
    });
    if (eventError && eventError.code !== "23505") throw eventError;
    return new Response("", { status: 200 });
  } catch (error) {
    console.error("Play RTDN processing failed", error);
    return new Response("", { status: 500 });
  }
});
