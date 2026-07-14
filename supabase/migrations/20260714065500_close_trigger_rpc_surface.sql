-- Trigger functions are implementation details, not client RPC endpoints.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
