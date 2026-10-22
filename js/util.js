import { PLAN_START, RACE_DATE, SESSIONS } from './plan-data.js';

const DAY = 86400000;

// Dates are handled as local calendar days (YYYY-MM-DD).
export const parseDay = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const daysBetween = (a, b) => Math.round((b - a) / DAY);
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-GB', opts);

export const planStart = parseDay(PLAN_START);
export const raceDate = parseDay(RACE_DATE);
export const WEEKS = 20;

/** Plan week (1–20) for a date, or 0 before / 21 after the plan. */
export function planWeek(d) {
  const w = Math.floor(daysBetween(planStart, d) / 7) + 1;
  return Math.max(0, Math.min(w, WEEKS + 1));
}

export const mid = (s) => (s.kmMin + s.kmMax) / 2;

/** Weekly planned vs actual km for all 20 weeks. */
export function weeklyTotals(runs) {
  return Array.from({ length: WEEKS }, (_, i) => {
    const week = i + 1;
    const start = addDays(planStart, i * 7);
    const end = addDays(start, 7);
    const planned = SESSIONS.filter((s) => s.week === week).reduce((t, s) => t + mid(s), 0);
    const actual = runs.filter((r) => r.date >= start && r.date < end).reduce((t, r) => t + r.km, 0);
    return { week, start, end, planned, actual };
  });
}

export const km1 = (x) => x.toFixed(1);
