# Rome Marathon Build

Training tracker for the Rome Marathon (Sunday 14 March 2027, goal 3:50:00).
Live site: https://4il1.github.io/rome-marathon-tracker/

- **Home**: countdown, weekly planned against actual km, latest run, links.
- **Plan**: B.A.A. Level One 20-week plan in km, with target paces for 3:50.
- **Runs**: run history (calendar, km by month, run log). Each run opens a detail page (`#run/<id>`):
  route map coloured by pace or heart rate, splits, pace/heart rate/elevation charts, zones, form.
- **Analysis**: marathon readiness, same-route comparison, fitness trends, training load and
  easy/hard balance, and recovery (sleep, HRV, Body Battery) behind a viewer password.

## How it works

Static site (HTML, CSS, JavaScript modules), hosted on GitHub Pages. Data lives in Supabase.

- **Garmin sync**: the `garmin-sync` Edge Function (`supabase/functions/garmin-sync`) pulls runs,
  activity files and daily recovery data from the Garmin Connect Personal API. pg_cron calls it at
  7 minutes past every hour. Run detail (splits, route, charts) is kept for runs since 2025-01-01;
  the first and last 300 m of each route are not stored.
- **Secrets**: `GARMIN_API_KEY` in Supabase Edge Function secrets (the key expires; renew it on
  Garmin Connect and update the secret). The sync secret is in Supabase Vault.
- **Human check**: visitors pass a Cloudflare Turnstile check once per browser, which creates an
  anonymous Supabase session (`js/gate.js`). The database serves data only to sessions.
- **Recovery**: readable only through `get_recovery(password, since)`. To change the viewer
  password, run in the Supabase SQL Editor (then delete the query from its history):
  `insert into private.viewer_password (id, hash) values (1, extensions.crypt('NEW PASSWORD', extensions.gen_salt('bf', 10))) on conflict (id) do update set hash = excluded.hash;`

Database changes are in `supabase/migrations`.

## Local preview

```
python tools/serve.py
```

Then open http://localhost:5500. The human check is skipped locally because Turnstile only works on
the live hostname, so the local preview has no Supabase session and cannot read data. Check data
views on the live site.

## Plan data

`js/plan-data.js` is generated from `tools/plan_source.py` (the plan transcribed in miles):

```
python tools/build_plan_data.py
```
