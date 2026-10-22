# Rome Marathon Build

Training tracker for the Rome Marathon (Sunday 14 March 2027, goal 3:50:00).
Live site: https://4il1.github.io/rome-marathon-tracker/

- **Home**: countdown, weekly planned against actual km, latest run, links.
- **Plan**: B.A.A. Level One 20-week plan in km, with target paces for 3:50.
- **Runs**: run history (calendar, km by month, run log) and owner-only Garmin CSV upload.
- **Progress**: predicted marathon time, personal bests, long runs, pace trend.

## How it works

Static site (HTML, CSS, JavaScript modules), hosted on GitHub Pages. Data lives in Supabase:
anyone can read runs, only the owner (signed in by email link) can add them.

## Local preview

```
python tools/serve.py
```

Then open http://localhost:5500.

## Plan data

`js/plan-data.js` is generated from `tools/plan_source.py` (the plan transcribed in miles):

```
python tools/build_plan_data.py
```
