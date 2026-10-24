-- Data is served only to sessions: visitors get an anonymous session after the Turnstile check
-- (js/gate.js). The publishable key on its own can no longer read anything.
drop policy if exists "anyone can view runs" on public.runs;
create policy "visitors with a session can view runs" on public.runs for select to authenticated using (true);

drop policy if exists "Anyone can read run details" on public.run_details;
create policy "visitors with a session can read run details" on public.run_details for select to authenticated using (true);

drop policy if exists "anyone can view likes" on public.likes;
drop policy if exists "anyone can like" on public.likes;
create policy "visitors with a session can view likes" on public.likes for select to authenticated using (true);
create policy "visitors with a session can like" on public.likes for insert to authenticated with check (true);

revoke execute on function public.get_recovery(text, date) from anon;
