-- Shared secret between pg_cron and the garmin-sync Edge Function. Generated here, never shown.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'garmin_sync_secret', 'x-sync-secret for the garmin-sync Edge Function');

create or replace function public.check_garmin_sync_secret(secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- $1, not `secret`: vault.decrypted_secrets has its own `secret` column, which would shadow the parameter.
  select exists (select 1 from vault.decrypted_secrets d where d.name = 'garmin_sync_secret' and d.decrypted_secret = $1 and $1 <> '');
$$;

revoke all on function public.check_garmin_sync_secret(text) from public, anon, authenticated;
grant execute on function public.check_garmin_sync_secret(text) to service_role;
