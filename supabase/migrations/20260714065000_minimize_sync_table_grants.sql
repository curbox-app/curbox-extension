-- RLS does not apply to TRUNCATE. Default broad grants exposed destructive and
-- schema-adjacent privileges that no Curbox client needs.
revoke all privileges on table public.vault, public.devices, public.sync_records from anon, authenticated;

-- Authenticated clients use these operations through owner-scoped RLS.
grant select, insert, update, delete
  on table public.vault, public.devices, public.sync_records
  to authenticated;
