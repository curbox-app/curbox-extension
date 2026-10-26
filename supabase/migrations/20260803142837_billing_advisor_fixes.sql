create index billing_purchases_user_id_idx
  on public.billing_purchases (user_id);

-- These internal tables intentionally have no client grants. Explicit deny
-- policies document that model and keep future grants from exposing rows.
create policy billing_purchases_deny_clients
on public.billing_purchases
as restrictive
for all
to authenticated
using (false)
with check (false);

create policy billing_webhook_events_deny_clients
on public.billing_webhook_events
as restrictive
for all
to authenticated
using (false)
with check (false);
