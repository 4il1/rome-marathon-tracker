-- Run garmin-sync at 7 minutes past every hour. Fetches the last 14 days; duplicates are skipped.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'garmin-sync-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://bxaobteunjqfidfhguvl.supabase.co/functions/v1/garmin-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'garmin_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
