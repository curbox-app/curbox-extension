-- The notification function is a trigger implementation, not a public RPC.
-- Triggers continue to execute it as the table owner after these revokes.
revoke execute on function public.notify_sync_change() from public, anon, authenticated;

-- Cache auth.uid() once per statement and keep both old-row and new-row
-- ownership checks explicit for writes.
drop policy if exists vault_owner on public.vault;
create policy vault_owner on public.vault
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists devices_owner on public.devices;
create policy devices_owner on public.devices
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists sync_records_owner on public.sync_records;
create policy sync_records_owner on public.sync_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists sync_records_device_id_idx
  on public.sync_records (device_id);
