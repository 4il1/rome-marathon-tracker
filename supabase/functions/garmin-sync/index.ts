// Sync Garmin Connect (Personal API) into Supabase: run summaries, run details and daily recovery.
// Called hourly by pg_cron (see supabase/migrations). Not called from the website.
//
// Secrets: GARMIN_API_KEY (Edge Functions > Secrets). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Auth: the caller sends x-sync-secret, checked against the Vault secret 'garmin_sync_secret'.
//
// Body (all optional):
//   full: true              summaries for all history instead of the last 14 days
//   dryRun: true            compare summaries with stored runs; save nothing
//   details: n              run files to process this call (default 3; each costs CPU time)
//   detailOffset: n         skip the first n missing runs (lets parallel backfill calls share the work)
//   recoveryFrom/recoveryTo recovery date range (YYYY-MM-DD, at most 28 days); default the last 7 days
//   only: 'details' | 'recovery'  run one part (for backfill calls)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Garmin, garminToken, type Json } from './garmin.ts';
import { runDetails } from './fit.ts';
import { recoveryRows } from './recovery.ts';

const DETAILS_FROM = '2025-01-01';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

// 'treadmill_running' -> 'Treadmill Running', matching the old CSV import's Activity Type.
const typeLabel = (key = 'running') => key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const round = (v: unknown, dp = 0) => (typeof v === 'number' ? Number(v.toFixed(dp)) : null);

/** Same shape as the old CSV import, so earlier rows match on (start_time, distance_km). */
function toRow(a: Json) {
  // Round metres to 10 m like Garmin's CSV export (1095 m -> 1.10 km; toFixed would give 1.09).
  const km = Math.round((a.distance ?? 0) / 10) / 100;
  const time = round(a.movingDuration ?? a.duration);
  return {
    garmin_activity_id: a.activityId as number,
    start_time: String(a.startTimeLocal).replace(' ', 'T'),
    title: a.activityName ?? null,
    type: typeLabel(a.activityType?.typeKey),
    distance_km: km,
    moving_time_s: time,
    avg_pace_s_per_km: km && time ? Math.round(time / km) : null,
    avg_hr: round(a.averageHR),
    max_hr: round(a.maxHR),
    elevation_m: round(a.elevationGain),
  };
}

async function syncSummaries(garmin: Garmin, since?: string) {
  const rows = (await garmin.runs(since)).map(toRow).filter((r) => r.distance_km > 0 && r.start_time !== 'undefined');
  if (!rows.length) return { garminRuns: 0 };
  // Runs already linked to Garmin update by activity id (so an edited distance does not duplicate);
  // the rest match on start time and distance, which links rows from the old CSV import.
  const { data: linked, error } = await db.from('runs').select('garmin_activity_id').in('garmin_activity_id', rows.map((r) => r.garmin_activity_id));
  if (error) throw error;
  const known = new Set(linked.map((x) => Number(x.garmin_activity_id)));
  const byId = rows.filter((r) => known.has(r.garmin_activity_id));
  const rest = rows.filter((r) => !known.has(r.garmin_activity_id));
  for (const [part, onConflict] of [[byId, 'garmin_activity_id'], [rest, 'start_time,distance_km']] as const) {
    if (!part.length) continue;
    const { error: e } = await db.from('runs').upsert(part, { onConflict });
    if (e) throw e;
  }
  return { garminRuns: rows.length, newlyLinked: rest.length };
}

async function zoneFloors(garmin: Garmin): Promise<number[]> {
  const zones: Json[] = await garmin.get('/biometric-service/heartRateZones/v2', { generateDefaults: 'true' });
  const z = zones.find((x) => x.sport === 'RUNNING') ?? zones.find((x) => x.sport === 'DEFAULT') ?? zones[0];
  return [z.zone1Floor, z.zone2Floor, z.zone3Floor, z.zone4Floor, z.zone5Floor];
}

async function syncDetails(garmin: Garmin, limit: number, offset: number) {
  const [{ data: runs, error: e1 }, { data: done, error: e2 }] = await Promise.all([
    db.from('runs').select('id,garmin_activity_id').not('garmin_activity_id', 'is', null)
      .gte('start_time', DETAILS_FROM).order('start_time', { ascending: false }),
    db.from('run_details').select('run_id'),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const have = new Set(done.map((x) => x.run_id));
  const missing = runs.filter((x) => !have.has(x.id));
  const batch = missing.slice(offset, offset + limit);
  if (!batch.length) return { missing: missing.length, processed: 0 };

  const floors = await zoneFloors(garmin);
  const results = [];
  for (const run of batch) {
    const base = { run_id: run.id, garmin_activity_id: run.garmin_activity_id };
    try {
      const detail = await runDetails(await garmin.activityFile(run.garmin_activity_id), floors);
      const { error } = await db.from('run_details').upsert({ ...base, ...detail, error: null });
      if (error) throw error;
      results.push({ run: run.id, ok: true });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      // Garmin allows about 100 requests a minute: stop and retry these runs on the next call.
      if (msg.includes('(429)')) { results.push({ run: run.id, rateLimited: true }); break; }
      // Store other failures so the run is not retried every hour (e.g. a manual entry has no file).
      await db.from('run_details').upsert({ ...base, error: msg });
      results.push({ run: run.id, error: msg });
    }
  }
  return { missing: missing.length, processed: batch.length, results };
}

async function syncRecovery(garmin: Garmin, from: string, to: string) {
  const rows = await recoveryRows(garmin, from, to);
  if (!rows.length) return { days: 0 };
  const cols = ['sleep_s', 'deep_s', 'rem_s', 'light_s', 'awake_s', 'sleep_score', 'sleep_hr', 'resting_hr', 'hrv_night', 'hrv_week', 'hrv_status', 'bb_charged', 'bb_drained', 'stress_avg'];
  const full = rows.map((r) => ({ ...Object.fromEntries(cols.map((c) => [c, null])), ...r }));
  const { error } = await db.from('recovery_daily').upsert(full, { onConflict: 'day' });
  if (error) throw error;
  return { from, to, days: rows.length };
}

Deno.serve(async (req) => {
  const { data: ok, error: authError } = await db.rpc('check_garmin_sync_secret', { secret: req.headers.get('x-sync-secret') ?? '' });
  if (authError) console.error('Secret check failed:', authError.message);
  if (authError || ok !== true) return json({ error: 'Unauthorised', reason: authError ? 'check unavailable' : 'wrong secret' }, 401);

  const opts = await req.json().catch(() => ({}));
  const report: Json = {};
  try {
    const apiKey = Deno.env.get('GARMIN_API_KEY');
    if (!apiKey) throw new Error('GARMIN_API_KEY secret is not set');
    const garmin = new Garmin(await garminToken(apiKey));

    if (opts.dryRun) {
      const rows = (await garmin.runs(opts.full ? undefined : isoDay(14 * 864e5))).map(toRow).filter((r) => r.distance_km > 0);
      const { data: stored, error } = await db.from('runs').select('start_time,distance_km');
      if (error) throw error;
      const key = (t: string, km: number) => `${t.slice(0, 19)}|${Number(km).toFixed(2)}`;
      const keys = new Set(stored.map((s) => key(s.start_time, s.distance_km)));
      const fresh = rows.filter((r) => !keys.has(key(r.start_time, r.distance_km)));
      return json({ dryRun: true, garminRuns: rows.length, stored: stored.length, new: fresh.map((r) => `${r.start_time} ${r.distance_km} km ${r.title ?? ''}`) });
    }

    const run = (part: string) => !opts.only || opts.only === part;
    if (run('summaries')) report.summaries = await syncSummaries(garmin, opts.full ? undefined : isoDay(14 * 864e5));
    if (run('details')) report.details = await syncDetails(garmin, opts.details ?? 3, opts.detailOffset ?? 0);
    if (run('recovery')) report.recovery = await syncRecovery(garmin, opts.recoveryFrom ?? isoDay(7 * 864e5), opts.recoveryTo ?? isoDay(0));
    return json(report);
  } catch (e) {
    console.error(e);
    return json({ ...report, error: (e as Error).message }, 500);
  }
});
