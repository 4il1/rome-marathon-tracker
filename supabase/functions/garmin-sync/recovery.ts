// Daily recovery data (sleep, HRV, Body Battery, resting heart rate, stress) as recovery_daily rows.
import type { Garmin, Json } from './garmin.ts';

/** First numeric value whose key matches the pattern, e.g. restingValue in an object of unknown shape. */
const pick = (o: Json | undefined, re: RegExp) => {
  for (const [k, v] of Object.entries(o ?? {})) if (re.test(k) && typeof v === 'number') return Math.round(v);
  return null;
};

export async function recoveryRows(g: Garmin, from: string, to: string) {
  const range = { startDate: from, endDate: to };
  const [sleep, hrv, battery, daily] = await Promise.all([
    g.get('/sleep-service/sleep/dailySleepSummariesByDate', range).catch(() => []),
    g.get(`/hrv-service/hrv/daily/${from}/${to}`).catch(() => ({})),
    g.get('/wellness-service/wellness/bodyBattery/reports/daily', range).catch(() => []),
    g.get('/usersummary-service/v2/dailysummaries', range).catch(() => ({})),
  ]);

  const days = new Map<string, Json>();
  const row = (day: string) => days.get(day) ?? days.set(day, { day, raw: {} }).get(day)!;

  for (const s of (sleep as Json[]) ?? []) {
    if (!s.calendarDate || !s.sleepTimeSeconds) continue;
    Object.assign(row(s.calendarDate), {
      sleep_s: s.sleepTimeSeconds, deep_s: s.deepSleepSeconds ?? null, rem_s: s.remSleepSeconds ?? null,
      light_s: s.lightSleepSeconds ?? null, awake_s: s.awakeSleepSeconds ?? null,
      sleep_score: s.sleepScores?.overall?.value ?? null, sleep_hr: s.avgHeartRate ?? null,
    });
  }
  for (const h of (hrv as Json).hrvSummaries ?? []) {
    Object.assign(row(h.calendarDate), { hrv_night: h.lastNightAvg ?? null, hrv_week: h.weeklyAvg ?? null, hrv_status: h.status ?? null });
  }
  for (const b of (battery as Json[]) ?? []) {
    if (b.date) Object.assign(row(b.date), { bb_charged: b.charged ?? null, bb_drained: b.drained ?? null });
  }
  for (const d of (daily as Json).data ?? []) {
    const x = row(d.calendarDate);
    x.resting_hr = pick(d.heartRate, /rest/i);
    x.stress_avg = pick(d.stress, /^(avg|average)/i);
    x.raw = { heartRate: d.heartRate, stress: d.stress, bodyBattery: d.bodyBattery };
  }
  return [...days.values()].map((x) => ({ ...x, updated_at: new Date().toISOString() }));
}
