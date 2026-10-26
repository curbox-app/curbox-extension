-- Server authoritative premium access shared by Polar and Google Play.
create table public.premium_entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('polar', 'google_play', 'manual')),
  status text not null check (
    status in ('active', 'trialing', 'grace_period', 'canceled', 'past_due', 'revoked', 'expired')
  ),
  valid_until timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_customer_id text,
  provider_subscription_id text,
  product_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create unique index premium_entitlements_provider_subscription_idx
  on public.premium_entitlements (provider, provider_subscription_id)
  where provider_subscription_id is not null;

alter table public.premium_entitlements enable row level security;

create policy premium_entitlements_owner_read
on public.premium_entitlements
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all privileges on table public.premium_entitlements from anon, authenticated;
grant select on table public.premium_entitlements to authenticated;
grant all privileges on table public.premium_entitlements to service_role;

-- Purchase tokens are represented only by a SHA-256 digest. The unique key
-- prevents one Play purchase from being attached to more than one Curbox user.
create table public.billing_purchases (
  provider text not null check (provider in ('google_play')),
  purchase_token_hash text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  provider_subscription_id text,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  primary key (provider, purchase_token_hash)
);

alter table public.billing_purchases enable row level security;
revoke all privileges on table public.billing_purchases from anon, authenticated;
grant all privileges on table public.billing_purchases to service_role;

-- External webhooks can be delivered more than once. Recording the provider's
-- event ID makes processing idempotent without exposing payloads or billing data.
create table public.billing_webhook_events (
  provider text not null check (provider in ('polar', 'google_play')),
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

alter table public.billing_webhook_events enable row level security;
revoke all privileges on table public.billing_webhook_events from anon, authenticated;
grant all privileges on table public.billing_webhook_events to service_role;

-- Security-invoker helper used by the sync tables' RLS policies. It has no
-- arguments, so a caller cannot probe another user's entitlement.
create function public.current_user_has_sync_entitlement()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.premium_entitlements
    where user_id = (select auth.uid())
      and status in ('active', 'trialing', 'grace_period', 'canceled')
      and (valid_until is null or valid_until > now())
  );
$$;

revoke all on function public.current_user_has_sync_entitlement() from public, anon;
grant execute on function public.current_user_has_sync_entitlement() to authenticated;

-- Replace the original owner-only policies. PostgreSQL combines permissive
-- policies with OR, so adding a second policy would not actually gate sync.
drop policy if exists vault_owner on public.vault;
create policy vault_premium_owner
on public.vault
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
)
with check (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
);

drop policy if exists devices_owner on public.devices;
create policy devices_premium_owner
on public.devices
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
)
with check (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
);

drop policy if exists sync_records_owner on public.sync_records;
create policy sync_records_premium_owner
on public.sync_records
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
)
with check (
  (select auth.uid()) = user_id
  and (select public.current_user_has_sync_entitlement())
);
