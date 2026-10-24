-- 24-point outline of each route (from the trimmed track) so the Analysis page can group runs by route
-- without downloading full tracks. Filled by trigger whenever track is written.
alter table public.run_details add column if not exists route jsonb;

create or replace function public.set_route_outline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare n int := coalesce(jsonb_array_length(new.track), 0);
begin
  new.route := case when n < 2 then null else (
    select jsonb_agg(jsonb_build_array(new.track -> idx -> 0, new.track -> idx -> 1) order by i)
    from (select i, round(i * (n - 1) / 23.0)::int as idx from generate_series(0, 23) i) s) end;
  return new;
end;
$$;

drop trigger if exists run_details_route on public.run_details;
create trigger run_details_route before insert or update of track on public.run_details
for each row execute function public.set_route_outline();

update public.run_details set track = track where track is not null;
