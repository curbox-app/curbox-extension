# Sync Premium billing setup

Sync Premium is one shared **$25 USD per year** entitlement. The browser extension and the directly distributed Android `full` flavor use Polar. The Play Store flavor uses Google Play Billing. Supabase remains the source of truth for access.

Never place a Polar token, webhook secret, Google service account, or Supabase service role key in an extension or APK.

## Polar

1. In Polar, create a recurring product for Sync Premium with a yearly interval and a $25 USD price.
2. Create an organization access token with checkout and customer session write access.
3. Add this webhook endpoint and subscribe it to `customer.state_changed`:

   `https://pdixkzhncuuxuxwhdwdh.supabase.co/functions/v1/polar-webhook`

4. Put these values in an untracked `supabase/.env.billing` file:

   ```dotenv
   POLAR_ACCESS_TOKEN=polar_oat_...
   POLAR_PRODUCT_ID=00000000-0000-0000-0000-000000000000
   POLAR_WEBHOOK_SECRET=polar_whs_...
   # Optional hosted pages to return to after checkout or portal use.
   POLAR_SUCCESS_URL=https://example.com/sync/thanks
   POLAR_RETURN_URL=https://example.com/sync
   ```

The checkout function sends the Supabase user ID as Polar's immutable external customer ID. The signed webhook then updates only that user's Polar entitlement.

## Google Play

1. In Play Console, create a subscription with product ID `curbox_sync`.
2. Add and activate a one year auto renewing base plan priced at $25 USD. The app prefers an eligible offer whose billing period is `P1Y`.
3. Enable the Google Play Developer API, link its service account to Play Console, and grant it permission to view and manage subscriptions and orders for Curbox.
4. Add the service account JSON as one line in `supabase/.env.billing`:

   ```dotenv
   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   GOOGLE_PLAY_PACKAGE_NAME=neth.iecal.curbox
   GOOGLE_PLAY_PRODUCT_ID=curbox_sync
   ```

5. Configure Real time developer notifications in Play Console through a Pub/Sub topic. Make the push subscription call:

   `https://pdixkzhncuuxuxwhdwdh.supabase.co/functions/v1/play-rtdn`

6. Enable authenticated Pub/Sub push with a dedicated service account and set the exact push audience and caller email:

   ```dotenv
   GOOGLE_PLAY_RTDN_AUDIENCE=https://pdixkzhncuuxuxwhdwdh.supabase.co/functions/v1/play-rtdn
   GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL=curbox-play-rtdn@example-project.iam.gserviceaccount.com
   ```

The app binds checkout to a SHA-256 obfuscated Supabase account ID. `play-verify` checks that ID with Google, rejects reused purchase tokens, records only a token hash, grants access, and acknowledges the purchase on the backend. `play-rtdn` verifies the Pub/Sub OIDC caller before applying renewals, refunds, holds, cancellations, or expirations.

## Supabase deployment

Load the secrets without committing the environment file:

```bash
npx supabase secrets set --env-file supabase/.env.billing
```

Apply the migrations in `supabase/migrations`, then deploy:

```bash
npx supabase functions deploy sync-entitlement
npx supabase functions deploy polar-checkout
npx supabase functions deploy polar-webhook --no-verify-jwt
npx supabase functions deploy play-verify
npx supabase functions deploy play-rtdn --no-verify-jwt
```

The migrations preserve existing encrypted sync rows. They replace the old owner-only RLS policies with owner plus active premium checks, so expired users keep their server data but cannot read or change it.

## Release checks

- Polar sandbox checkout activates sync in the extension and the `full` Android flavor.
- Polar cancellation keeps access through the paid period; revocation removes it immediately.
- A Play license tester can buy, restore, and cancel `curbox_sync`.
- A pending, paused, on hold, expired, refunded, or mismatched Play purchase does not unlock sync.
- The same Play purchase token cannot unlock two Supabase accounts.
- The `fdroid` flavor still compiles without Billing, Supabase, Firebase, or internet access.
