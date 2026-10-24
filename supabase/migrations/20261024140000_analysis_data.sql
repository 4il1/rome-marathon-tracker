-- Phase 1 of the Analysis page: per-run detail from Garmin activity files, daily recovery data,
-- and a viewer password for recovery data. Written by the garmin-sync Edge Function (service role).

alter table public.runs add column if not exists garmin_activity_id bigint unique;

-- One row per run with a Garmin activity file (runs since 2025-01-01).
create table if not exists public.run_details (
  run_id bigint primary key references public.runs(id) on delete cascade,
  garmin_activity_id bigint not null unique,
  splits jsonb,                   -- [{km, s, hr, cad, up, down}] per km; the last can be partial
  track jsonb,                    -- [[lat, lng, metres, speed cm/s, hr], ...]; first and last 300 m removed; null indoors
  stream jsonb,                   -- {t, d, v, hr, alt, cad}: 15-second averages for charts
  hr_zone_s int[],                -- seconds in Garmin heart rate zones 1-5
  drift_pct numeric,              -- speed per heartbeat, first half against second half (aerobic decoupling)
  form jsonb,                     -- {cadence, stride_m, gct_ms, vo_mm, vr_pct}
  training_effect jsonb,          -- {aerobic, anaerobic}
  error text,                     -- set when the activity file could not be read; the run is not retried
  created_at timestamptz not null default now()
);
alter table public.run_details enable row level security;
create policy "Anyone can read run details" on public.run_details for select using (true);

-- One row per day. No read policy: only get_recovery() (password) and the service role can read it.
create table if not exists public.recovery_daily (
  day date primary key,
  sleep_s int, deep_s int, rem_s int, light_s int, awake_s int,
  sleep_score int, sleep_hr int, resting_hr int,
  hrv_night int, hrv_week int, hrv_status text,
  bb_charged int, bb_drained int,
  stress_avg int,
  raw jsonb,
  updated_at timestamptz not null default now()
);
alter table public.recovery_daily enable row level security;

-- Viewer password, stored only as a bcrypt hash, in a schema the API does not expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.viewer_password (id int primary key default 1 check (id = 1), hash text not null);
create table if not exists private.recovery_failures (at timestamptz not null default now());

-- Returns {ok, rows} or {ok: false, reason}. More than 30 wrong passwords in an hour locks it for the hour.
create or replace function public.get_recovery(password text, since date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from private.recovery_failures where at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if not exists (select 1 from private.viewer_password v where v.hash = extensions.crypt($1, v.hash)) then
    insert into private.recovery_failures default values;
    delete from private.recovery_failures where at < now() - interval '1 day';
    return jsonb_build_object('ok', false, 'reason', 'wrong password');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(to_jsonb(r) - 'raw' - 'updated_at' order by r.day)
    from public.recovery_daily r where r.day >= $2), '[]'::jsonb));
end;
$$;
revoke all on function public.get_recovery(text, date) from public;
grant execute on function public.get_recovery(text, date) to anon, authenticated;
