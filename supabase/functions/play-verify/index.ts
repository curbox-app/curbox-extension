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
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
  const tokenResponse = await fetch(serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const tokenJson = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenJson.access_token) throw new Error(tokenJson.error_description ?? "Google authentication failed");
  return tokenJson.access_token;
}

type SubscriptionPurchase = {
  subscriptionState?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "sign in first" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authorization } } },
  );
  const authToken = authorization.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userError } = await userClient.auth.getUser(authToken);
  if (userError || !user) return json({ error: "invalid session" }, 401);

  const body = await req.json().catch(() => ({})) as { purchaseToken?: string };
  if (!body.purchaseToken || body.purchaseToken.length > 4096) return json({ error: "invalid purchase token" }, 400);
  const rawServiceAccount = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const packageName = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME") ?? "neth.iecal.curbox";
  const productId = Deno.env.get("GOOGLE_PLAY_PRODUCT_ID") ?? "curbox_sync";
  if (!rawServiceAccount) return json({ error: "Google Play billing is not configured" }, 503);

  try {
    const serviceAccount = JSON.parse(rawServiceAccount) as { client_email: string; private_key: string; token_uri?: string };
    const googleToken = await googleAccessToken(serviceAccount);
    const purchaseResponse = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(body.purchaseToken)}`,
      { headers: { authorization: `Bearer ${googleToken}` } },
    );
    const purchase = await purchaseResponse.json().catch(() => ({})) as SubscriptionPurchase & { error?: { message?: string } };
    if (!purchaseResponse.ok) return json({ error: purchase.error?.message ?? "Google Play could not verify this purchase" }, 400);

    const accountHash = await sha256(user.id);
    if (purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId !== accountHash) {
      return json({ error: "This purchase belongs to another Curbox account" }, 409);
    }
    const matchingItems = (purchase.lineItems ?? []).filter((item) => item.productId === productId && item.expiryTime);
    const validUntilMs = Math.max(...matchingItems.map((item) => Date.parse(item.expiryTime!)), 0);
    const activeStates = new Set([
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_CANCELED",
    ]);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const purchaseHash = await sha256(body.purchaseToken);
    const { data: existing } = await admin
      .from("billing_purchases")
      .select("user_id")
      .eq("provider", "google_play")
      .eq("purchase_token_hash", purchaseHash)
      .maybeSingle();
    if (existing && existing.user_id !== user.id) return json({ error: "This purchase belongs to another Curbox account" }, 409);

    const now = new Date().toISOString();
    const { error: purchaseError } = await admin.from("billing_purchases").upsert({
      provider: "google_play",
      purchase_token_hash: purchaseHash,
      user_id: user.id,
      product_id: productId,
      provider_subscription_id: purchaseHash,
      last_verified_at: now,
    }, { onConflict: "provider,purchase_token_hash" });
    if (purchaseError) throw purchaseError;

    if (!activeStates.has(purchase.subscriptionState ?? "") || validUntilMs <= Date.now()) {
      const status = purchase.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED" ? "expired" : "revoked";
      const { error: entitlementError } = await admin.from("premium_entitlements").upsert({
        user_id: user.id,
        provider: "google_play",
        status,
        valid_until: now,
        cancel_at_period_end: false,
        provider_subscription_id: purchaseHash,
        product_id: productId,
        updated_at: now,
      }, { onConflict: "user_id,provider" });
      if (entitlementError) throw entitlementError;
      return json({ entitled: false, provider: "google_play", price: "$25" });
    }

    if (purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      const acknowledge = await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(body.purchaseToken)}:acknowledge`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${googleToken}`, "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!acknowledge.ok && acknowledge.status !== 409) {
        return json({ error: "Google Play could not finish this purchase" }, 502);
      }
    }

    const status = purchase.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      ? "grace_period"
      : (purchase.subscriptionState === "SUBSCRIPTION_STATE_CANCELED" ? "canceled" : "active");
    const validUntil = new Date(validUntilMs).toISOString();
    const { error: entitlementError } = await admin.from("premium_entitlements").upsert({
      user_id: user.id,
      provider: "google_play",
      status,
      valid_until: validUntil,
      cancel_at_period_end: status === "canceled",
      provider_subscription_id: purchaseHash,
      product_id: productId,
      updated_at: now,
    }, { onConflict: "user_id,provider" });
    if (entitlementError) throw entitlementError;

    return json({ entitled: true, provider: "google_play", validUntil, price: "$25" });
  } catch (error) {
    console.error("Play purchase verification failed", error);
    return json({ error: "Could not verify the Google Play purchase" }, 500);
  }
});
