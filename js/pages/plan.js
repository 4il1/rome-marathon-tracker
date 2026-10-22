import { SESSIONS } from '../plan-data.js';
import { PACES, withPaces, sessionPace } from '../paces.js';
import { loadRuns } from '../data.js';
import { today, planStart, planWeek, parseDay, addDays, fmtDate, km1, WEEKS } from '../util.js';

const TYPES = {
  easy: 'Easy', aer: 'Aerobic', q: 'Speed / pace', long: 'Long run', xt: 'Cross or strength', rest: 'Rest', race: 'Race',
};
const RUN_TYPES = new Set(['easy', 'aer', 'q', 'long', 'race']);
const STATUS = {
  done: { label: 'Done', icon: '<path d="M5 12l5 5 9-10"/>' },
  partial: { label: 'Partial', icon: '<path d="M5 12h14"/>' },
  missed: { label: 'Missed', icon: '<path d="M6 6l12 12M18 6L6 18"/>' },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Done: ran at least 90% of the minimum distance that day. Partial: ran, but less. Missed: no run. */
function status(session, kmRun, now) {
  if (!RUN_TYPES.has(session.type) || parseDay(session.date) >= now) return null;
  if (kmRun >= session.kmMin * 0.9) return 'done';
  return kmRun > 0 ? 'partial' : 'missed';
}

export async function renderPlan(root) {
  const runs = await loadRuns();
  const now = today();
  const current = planWeek(now);
  const kmByDay = {};
  for (const r of runs) kmByDay[iso(r.date)] = (kmByDay[iso(r.date)] ?? 0) + r.km;

  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const week = i + 1;
    const monday = addDays(planStart, i * 7);
    const sessions = SESSIONS.filter((s) => s.week === week);
    return { week, monday, phase: sessions[0].phase, sessions };
  });

  root.innerHTML = `
    <h1>Training plan</h1>
    <p class="lede">B.A.A. Level One · 20 weeks · paces set for a 3:50:00 finish</p>

    <section class="pace-key" aria-label="Target paces">
      ${[['Easy', PACES.easy, 'easy'], ['Aerobic', PACES.aerobic, 'aer'], ['Marathon (MP)', PACES.MP, 'race'], ['Half marathon (HMP)', PACES.HMP, 'q'], ['10K', PACES['10K'], 'q'], ['5K', PACES['5K'], 'q']]
        .map(([n, p, t]) => `<div class="pace-chip t-${t}"><span>${n}</span><b>${p}<small>/km</small></b></div>`).join('')}
    </section>

    <div class="weeks">${weeks.map((w) => weekHtml(w, current, now, kmByDay)).join('')}</div>`;

  const target = root.querySelector(`#week-${Math.min(Math.max(current, 1), WEEKS)}`);
  if (target && current > 1) target.scrollIntoView({ block: 'start' });
}

function weekHtml({ week, monday, phase, sessions }, current, now, kmByDay) {
  const planned = sessions.reduce((t, s) => t + (s.kmMin + s.kmMax) / 2, 0);
  const runSessions = sessions.filter((s) => RUN_TYPES.has(s.type));
  const statuses = runSessions.map((s) => status(s, kmByDay[s.date] ?? 0, now));
  const done = statuses.filter((x) => x === 'done').length;
  const past = statuses.filter(Boolean).length;
  const isNow = week === current;

  return `
    <section class="week ${isNow ? 'now' : ''}" id="week-${week}" aria-labelledby="wh-${week}">
      <header class="week-head">
        <h2 id="wh-${week}">Week ${week}${isNow ? ' <span class="tag">This week</span>' : ''}</h2>
        <span class="muted">${phase} · ${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}</span>
        <span class="week-meta">≈ ${Math.round(planned)} km${past ? ` · ${done}/${runSessions.length} runs done` : ''}</span>
      </header>
      <div class="days">
        ${dayHtml({ date: monday, type: 'rest', title: 'Rest', detail: '' }, null, null)}
        ${sessions.map((s) => {
          const ran = kmByDay[s.date] ?? 0;
          return dayHtml({ ...s, date: parseDay(s.date) }, status(s, ran, now), ran);
        }).join('')}
      </div>
    </section>`;
}

function dayHtml(s, st, ran) {
  const pace = sessionPace(s.type, s.title);
  return `
    <article class="day t-${s.type} ${st ? `s-${st}` : ''}">
      <div class="day-date"><b>${fmtDate(s.date, { weekday: 'short' })}</b><span>${fmtDate(s.date, { day: 'numeric', month: 'short' })}</span></div>
      <div class="day-body">
        <div class="day-title">${s.title}${pace ? ` <span class="pace">${pace}/km</span>` : ''}</div>
        ${s.detail ? `<div class="day-detail">${withPaces(s.detail)}</div>` : ''}
        ${st ? `<div class="status"><svg viewBox="0 0 24 24" aria-hidden="true">${STATUS[st].icon}</svg>${STATUS[st].label}${ran ? ` · ran ${km1(ran)} km` : ''}</div>` : ''}
      </div>
      <span class="sr-only">${TYPES[s.type]}</span>
    </article>`;
}
