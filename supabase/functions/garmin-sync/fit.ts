// Turn a Garmin activity file (zip with one .fit) into the run_details row.
import { unzipSync } from 'npm:fflate@0.8.3';
import FitParser from 'npm:fit-file-parser@6.1.2';
import type { Json } from './garmin.ts';

const PRIVACY_TRIM_M = 300; // route points within 300 m of the start or end are not stored
const TRACK_STEP_M = 25;
const STREAM_STEP_S = 15;
const PAUSE_GAP_S = 15; // a gap between records longer than this, with little movement, is a pause

type Rec = { t: number; d: number; v: number | null; hr: number | null; alt: number | null; cad: number | null; lat?: number; lng?: number };

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const r = (x: number | null | undefined, dp = 0) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(dp)));
const spm = (cad?: number, frac?: number) => (typeof cad === 'number' && cad > 0 ? (cad + (frac ?? 0)) * 2 : null);

async function parseFit(zipBytes: Uint8Array): Promise<Json> {
  const zip = unzipSync(zipBytes);
  const name = Object.keys(zip).find((n) => n.toLowerCase().endsWith('.fit'));
  if (!name) throw new Error(`No .fit file in activity zip (${Object.keys(zip).join(', ')})`);
  const bytes = zip[name];
  return await new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' })
    .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** Records with moving time t (pauses removed) and cumulative distance d. */
function movingRecords(raw: Json[]): Rec[] {
  const out: Rec[] = [];
  let t = 0;
  let prev: Json | undefined;
  for (const x of raw) {
    if (!x.timestamp || typeof x.distance !== 'number') continue;
    if (prev) {
      const gap = (Date.parse(x.timestamp) - Date.parse(prev.timestamp)) / 1000;
      const moved = x.distance - prev.distance;
      if (gap > 0) t += gap > PAUSE_GAP_S && moved < gap * 0.5 ? 0 : gap;
    }
    out.push({
      t, d: x.distance,
      v: typeof (x.enhanced_speed ?? x.speed) === 'number' ? x.enhanced_speed ?? x.speed : null,
      hr: typeof x.heart_rate === 'number' && x.heart_rate > 0 ? x.heart_rate : null,
      alt: typeof (x.enhanced_altitude ?? x.altitude) === 'number' ? x.enhanced_altitude ?? x.altitude : null,
      cad: spm(x.cadence, x.fractional_cadence),
      lat: typeof x.position_lat === 'number' ? x.position_lat : undefined,
      lng: typeof x.position_long === 'number' ? x.position_long : undefined,
    });
    prev = x;
  }
  return out;
}

/** Time (s) at distance m, interpolated between records. */
function timeAt(recs: Rec[], m: number): number {
  let i = recs.findIndex((x) => x.d >= m);
  if (i <= 0) return i === 0 ? recs[0].t : recs[recs.length - 1].t;
  const a = recs[i - 1], b = recs[i];
  return a.t + (b.t - a.t) * ((m - a.d) / (b.d - a.d || 1));
}

/** Ascent and descent, counting only changes of 2 m or more so altitude jitter is not counted as climbing. */
function climb(recs: Rec[]) {
  let up = 0, down = 0, ref: number | null = null;
  for (const { alt } of recs) {
    if (alt == null) continue;
    if (ref == null) { ref = alt; continue; }
    if (alt - ref >= 2) { up += alt - ref; ref = alt; } else if (ref - alt >= 2) { down += ref - alt; ref = alt; }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

function kmSplits(recs: Rec[]) {
  const total = recs[recs.length - 1]?.d ?? 0;
  const splits = [];
  for (let start = 0; start < total - 50; start += 1000) {
    const end = Math.min(start + 1000, total);
    const t0 = timeAt(recs, start), t1 = timeAt(recs, end);
    const part = recs.filter((x) => x.d >= start && x.d <= end);
    splits.push({
      km: r((end - start) / 1000, 2), s: r(t1 - t0), hr: r(avg(part.map((x) => x.hr))),
      cad: r(avg(part.map((x) => x.cad))), ...climb(part),
    });
  }
  return splits;
}

function track(recs: Rec[]) {
  const pts = recs.filter((x) => x.lat != null && x.lng != null);
  if (pts.length < 10) return null;
  const end = pts[pts.length - 1].d;
  const out: number[][] = [];
  let last = -Infinity;
  for (const x of pts) {
    if (x.d < PRIVACY_TRIM_M || x.d > end - PRIVACY_TRIM_M || x.d - last < TRACK_STEP_M) continue;
    out.push([r(x.lat, 5)!, r(x.lng, 5)!, Math.round(x.d), Math.round((x.v ?? 0) * 100), x.hr ?? 0]);
    last = x.d;
  }
  return out.length ? out : null;
}

function stream(recs: Rec[]) {
  const s = { t: [] as number[], d: [] as number[], v: [] as (number | null)[], hr: [] as (number | null)[], alt: [] as (number | null)[], cad: [] as (number | null)[] };
  const end = recs[recs.length - 1]?.t ?? 0;
  for (let t0 = 0, i = 0; t0 < end; t0 += STREAM_STEP_S) {
    const bucket: Rec[] = [];
    while (i < recs.length && recs[i].t < t0 + STREAM_STEP_S) bucket.push(recs[i++]);
    if (!bucket.length) continue;
    s.t.push(t0);
    s.d.push(Math.round(bucket[bucket.length - 1].d));
    s.v.push(r(avg(bucket.map((x) => x.v)), 2));
    s.hr.push(r(avg(bucket.map((x) => x.hr))));
    s.alt.push(r(avg(bucket.map((x) => x.alt)), 1));
    s.cad.push(r(avg(bucket.map((x) => x.cad))));
  }
  return s;
}

/** Seconds in each of Garmin's five heart rate zones; floors = [z1, z2, z3, z4, z5]. */
function zoneSeconds(recs: Rec[], floors: number[]) {
  const out = [0, 0, 0, 0, 0];
  for (let i = 1; i < recs.length; i++) {
    const hr = recs[i].hr;
    const dt = Math.min(recs[i].t - recs[i - 1].t, 10);
    if (hr == null || dt <= 0 || hr < floors[0]) continue;
    let z = 0;
    while (z < 4 && hr >= floors[z + 1]) z++;
    out[z] += dt;
  }
  return out.map(Math.round);
}

/** Aerobic decoupling: drop in speed-per-heartbeat from the first to the second half. Under 5% is good. */
function drift(recs: Rec[]) {
  const end = recs[recs.length - 1]?.t ?? 0;
  if (end < 20 * 60) return null;
  const ef = (a: number, b: number) => {
    const part = recs.filter((x) => x.t >= a && x.t < b);
    const v = avg(part.map((x) => x.v)), hr = avg(part.map((x) => x.hr));
    return v && hr ? v / hr : null;
  };
  const first = ef(0, end / 2), second = ef(end / 2, end);
  return first && second ? r(((first - second) / first) * 100, 1) : null;
}

export async function runDetails(zipBytes: Uint8Array, zoneFloors: number[]) {
  const fit = await parseFit(zipBytes);
  const recs = movingRecords(fit.records ?? []);
  if (recs.length < 10) throw new Error('Activity file has too few records');
  const s: Json = fit.sessions?.[0] ?? {};
  return {
    splits: kmSplits(recs),
    track: track(recs),
    stream: stream(recs),
    hr_zone_s: zoneSeconds(recs, zoneFloors),
    drift_pct: drift(recs),
    form: {
      cadence: r(spm(s.avg_cadence, s.avg_fractional_cadence)),
      stride_m: r(typeof s.avg_step_length === 'number' ? s.avg_step_length / 1000 : null, 2),
      gct_ms: r(s.avg_stance_time),
      vo_mm: r(s.avg_vertical_oscillation, 1),
      vr_pct: r(s.avg_vertical_ratio, 2),
    },
    training_effect: { aerobic: r(s.total_training_effect, 1), anaerobic: r(s.total_anaerobic_training_effect, 1) },
  };
}
