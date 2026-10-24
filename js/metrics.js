// Training metrics for the Analysis page. Runs come from loadRuns(); details (run_id -> row) from loadDetails().
import { addDays, today } from './util.js';

const DAY = 864e5;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Metres covered per heartbeat: speed against effort. Rising over time means fitter. */
export const efficiency = (r) => (r.moving_time_s && r.avg_hr ? (r.km * 1000) / (r.moving_time_s / 60) / r.avg_hr : null);

/** Monday 00:00 of the week containing d. */
export const weekStart = (d) => { const m = new Date(d); m.setHours(0, 0, 0, 0); return addDays(m, -((m.getDay() + 6) % 7)); };

// --- Same route ---------------------------------------------------------------------------------

const metres = ([lat1, lng1], [lat2, lng2]) => {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(lat2 - lat1, x) * 111_320;
};
const outlineGap = (a, b) => avg(a.map((p, i) => metres(p, b[i])));

/**
 * Groups runs that follow the same route: distance within 6% and a mean gap under 150 m between
 * their 24-point outlines (start and end are trimmed for privacy, so outlines begin 300 m in).
 * Returns routes with at least `min` runs, most-run first; runs inside each are oldest first.
 */
export function routes(runs, details, min = 4) {
  const groups = [];
  const withRoute = runs.filter((r) => details.get(r.id)?.route?.length === 24 && r.km >= 3);
  for (const r of withRoute) {
    const outline = details.get(r.id).route;
    const g = groups.find((x) => Math.abs(r.km - x.km) / x.km < 0.06 && outlineGap(outline, x.outline) < 150);
    if (g) g.runs.push(r); else groups.push({ km: r.km, outline, runs: [r] });
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return groups
    .filter((g) => g.runs.length >= min)
    .map((g) => {
      g.runs.sort((a, b) => a.date - b.date);
      const titles = countBy(g.runs.map((r) => r.title ?? 'Run'));
      const days = countBy(g.runs.map((r) => DAYS[r.date.getDay()]));
      return {
        id: `${g.runs[0].id}`,
        km: avg(g.runs.map((r) => r.km)),
        name: titles[0][0].replace(/ Running$/, ''),
        usualDays: days.filter(([, n]) => n >= g.runs.length * 0.25).map(([d]) => d),
        runs: g.runs,
      };
    })
    .sort((a, b) => b.runs.length - a.runs.length);
}

function countBy(xs) {
  const m = new Map();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1]);
}

// --- Fitness ------------------------------------------------------------------------------------

/** Easy runs: at least 70% of heart rate time in zones 1-2. */
export const isEasy = (d) => {
  const z = d?.hr_zone_s;
  const total = z ? z.reduce((a, b) => a + b, 0) : 0;
  return total > 0 && (z[0] + z[1]) / total >= 0.7;
};

/** Trailing mean of `value` over the previous `days` days, for each point. */
export function rolling(points, days) {
  return points.map((p) => {
    const win = points.filter((q) => q.date <= p.date && p.date - q.date < days * DAY).map((q) => q.value);
    return { date: p.date, value: avg(win) };
  });
}

/** Mean of `value` per calendar month, for points with a value. */
export function monthly(points) {
  const m = new Map();
  for (const p of points) {
    if (p.value == null) continue;
    const key = `${p.date.getFullYear()}-${p.date.getMonth()}`;
    if (!m.has(key)) m.set(key, { date: new Date(p.date.getFullYear(), p.date.getMonth(), 1), values: [] });
    m.get(key).values.push(p.value);
  }
  return [...m.values()].sort((a, b) => a.date - b.date).map((x) => ({ date: x.date, value: avg(x.values) }));
}

// --- Load and balance ---------------------------------------------------------------------------

/**
 * Acute:chronic workload ratio by day: km in the last 7 days against the average week of the last 28.
 * 0.8-1.3 is the usual safe range; above 1.5 sharply raises injury risk.
 */
export function workload(runs, days = 182) {
  const end = today();
  const kmOn = new Map();
  runs.forEach((r) => { const k = r.date.toDateString(); kmOn.set(k, (kmOn.get(k) ?? 0) + r.km); });
  const sum = (to, n) => { let t = 0; for (let i = 0; i < n; i++) t += kmOn.get(addDays(to, -i).toDateString()) ?? 0; return t; };
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(end, i - days + 1);
    const acute = sum(date, 7), chronic = sum(date, 28) / 4;
    return { date, acute, chronic, ratio: chronic > 0 ? acute / chronic : null };
  });
}

export function workloadStatus(ratio) {
  if (ratio == null) return { key: 'none', label: 'Not enough data' };
  if (ratio > 1.5) return { key: 'critical', label: 'High injury risk: cut back' };
  if (ratio > 1.3) return { key: 'warning', label: 'Rising fast: hold steady' };
  if (ratio >= 0.8) return { key: 'good', label: 'Safe range' };
  return { key: 'low', label: 'Below your usual load' };
}

/** Share of heart rate time that was easy (zones 1-2), moderate (3) and hard (4-5), per week. */
export function intensityByWeek(runs, details, weeks = 16) {
  const start = addDays(weekStart(today()), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(start, i * 7), to = addDays(from, 7);
    const z = [0, 0, 0, 0, 0];
    runs.filter((r) => r.date >= from && r.date < to).forEach((r) => details.get(r.id)?.hr_zone_s?.forEach((s, k) => { z[k] += s; }));
    const total = z.reduce((a, b) => a + b, 0);
    const pct = (s) => (total ? (s / total) * 100 : null);
    return { start: from, easy: pct(z[0] + z[1]), moderate: pct(z[2]), hard: pct(z[3] + z[4]), minutes: total / 60 };
  });
}

// --- Marathon readiness -------------------------------------------------------------------------

/** Kilometres run within 10 s/km of goal pace, per week (from km splits). */
export function goalPaceKm(runs, details, goalPaceS, weeks = 16) {
  const start = addDays(weekStart(today()), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(start, i * 7), to = addDays(from, 7);
    let km = 0;
    runs.filter((r) => r.date >= from && r.date < to).forEach((r) => {
      for (const s of details.get(r.id)?.splits ?? []) if (s.km >= 0.9 && Math.abs(s.s / s.km - goalPaceS) <= 10) km += s.km;
    });
    return { start: from, km };
  });
}
