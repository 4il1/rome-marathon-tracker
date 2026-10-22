import { SESSIONS } from '../plan-data.js';
import { PACES } from '../paces.js';
import { CONFIG } from '../config.js';
import { loadRuns } from '../data.js';
import { today, addDays, planStart, planWeek, daysBetween, fmtDate, km1, WEEKS } from '../util.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MARATHON = 42.195;
const toSec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
const clock = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };
const paceStr = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const timed = (r) => r.moving_time_s && r.km > 0;

// Riegel's formula: predicted time scales with distance to the power 1.06.
const riegel = (t, d1, d2) => t * (d2 / d1) ** 1.06;

/** Best time for a distance, from runs between that distance and 5% over, scaled to the exact distance. */
function best(runs, dist) {
  let top = null;
  for (const r of runs) {
    if (!timed(r) || r.km < dist || r.km > dist * 1.05) continue;
    const t = (r.moving_time_s / r.km) * dist;
    if (!top || t < top.t) top = { t, run: r };
  }
  return top;
}

const charts = [];

export async function renderProgress(root) {
  const runs = await loadRuns();
  const now = today();
  const current = planWeek(now);
  const goal = toSec(CONFIG.goalTime);

  // Prediction: from the run of 10 km or more in the last 12 weeks that predicts the fastest marathon.
  const recent = runs.filter((r) => timed(r) && r.km >= 10 && daysBetween(r.date, now) <= 84);
  const pred = recent.map((r) => ({ run: r, t: riegel(r.moving_time_s, r.km, MARATHON) })).sort((a, b) => a.t - b.t)[0];
  const vsGoal = pred ? goal - pred.t : 0;

  const pbs = [['5K', 5], ['10K', 10], ['Half marathon', 21.0975]].map(([name, d]) => ({ name, ...best(runs, d) }));

  root.innerHTML = `
    <h1>Progress</h1>
    <p class="lede">Am I on track for ${CONFIG.goalTime}?</p>

    <div class="cards">
      <div class="card">
        <div class="label">Predicted marathon</div>
        ${pred ? `<div class="big lime">${clock(pred.t)}</div>
          <div class="sub">${vsGoal >= 0 ? `${clock(vsGoal)} inside` : `${clock(-vsGoal)} outside`} your ${CONFIG.goalTime} goal</div>
          <div class="sub">From ${km1(pred.run.km)} km on ${fmtDate(pred.run.date)}</div>`
        : '<div class="big">–</div><div class="sub">Needs a 10 km+ run in the last 12 weeks</div>'}
      </div>
      ${pbs.map((p) => `
      <div class="card">
        <div class="label">${p.name} best</div>
        ${p.t ? `<div class="big">${clock(p.t)}</div><div class="sub">${paceStr(p.t / (p.name === '5K' ? 5 : p.name === '10K' ? 10 : 21.0975))} /km · ${fmtDate(p.run.date, { day: 'numeric', month: 'short', year: 'numeric' })}</div>`
        : '<div class="big">–</div>'}
      </div>`).join('')}
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Long runs</h2><div class="muted small">Your longest run each plan week against the plan's long run</div></div>
        <div class="legend"><span><i style="background:${css('--planned')}"></i>Planned</span><span><i style="background:${css('--lime')}"></i>Longest run</span></div>
      </div>
      <div class="chart"><canvas id="long" role="img" aria-label="Planned long run and actual longest run for each plan week"></canvas></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Pace trend</h2><div class="muted small">Average pace each week for the last 26 weeks · higher is faster</div></div>
        <div class="legend"><span><i style="background:${css('--lime')}"></i>Weekly pace</span><span><i class="dash"></i>Marathon pace ${PACES.MP}</span><span><i class="dash easy"></i>Easy ${PACES.easy}</span></div>
      </div>
      <div class="chart"><canvas id="pace" role="img" aria-label="Line chart of average weekly pace against marathon and easy pace"></canvas></div>
    </section>`;

  charts.splice(0).forEach((c) => c.destroy());
  charts.push(drawLong(root.querySelector('#long'), runs, now, current));
  charts.push(drawPace(root.querySelector('#pace'), runs, now));
}

function baseOptions(yTicks) {
  const muted = css('--muted'), border = css('--border');
  return {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1E2127', borderColor: border, borderWidth: 1, padding: 10 } },
    scales: {
      x: { grid: { display: false }, border: { color: border }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 8 } },
      y: { grid: { color: border }, border: { display: false }, ticks: { color: muted, ...yTicks } },
    },
  };
}

function drawLong(canvas, runs, now, current) {
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const week = i + 1, start = addDays(planStart, i * 7), end = addDays(start, 7);
    const planned = Math.max(...SESSIONS.filter((s) => s.week === week && s.type !== 'race').map((s) => (s.kmMin + s.kmMax) / 2));
    const inWeek = runs.filter((r) => r.date >= start && r.date < end);
    const longest = start <= now ? Math.max(0, ...inWeek.map((r) => r.km)) : null;
    return { week, start, planned, longest };
  });
  const opts = baseOptions({ callback: (v) => `${v} km` });
  opts.scales.y.beginAtZero = true;
  opts.scales.x.ticks.color = (c) => (c.index + 1 === current ? css('--lime') : css('--muted'));
  opts.scales.x.title = { display: true, text: 'Plan week', color: css('--muted') };
  opts.plugins.tooltip.callbacks = {
    title: (i) => `Week ${weeks[i[0].dataIndex].week} · from ${fmtDate(weeks[i[0].dataIndex].start)}`,
    label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '–' : `${c.raw.toFixed(1)} km`}`,
  };
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week),
      datasets: [
        { label: 'Planned', data: weeks.map((w) => +w.planned.toFixed(1)), backgroundColor: css('--planned'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, barPercentage: 0.9 },
        { label: 'Longest run', data: weeks.map((w) => (w.longest == null ? null : +w.longest.toFixed(1))), backgroundColor: css('--lime'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, barPercentage: 0.9 },
      ],
    },
    options: opts,
  });
}

function drawPace(canvas, runs, now) {
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const weeks = Array.from({ length: 26 }, (_, i) => {
    const start = addDays(monday, (i - 25) * 7), end = addDays(start, 7);
    const wr = runs.filter((r) => timed(r) && r.date >= start && r.date < end);
    const km = wr.reduce((t, r) => t + r.km, 0), secs = wr.reduce((t, r) => t + r.moving_time_s, 0);
    return { start, pace: km ? secs / km : null, km };
  });
  const mp = toSec(PACES.MP), easy = toSec(PACES.easy);
  const vals = weeks.map((w) => w.pace).filter(Boolean).concat([mp, easy]);
  const opts = baseOptions({ callback: (v) => paceStr(v), stepSize: 15 });
  Object.assign(opts.scales.y, { reverse: true, min: Math.floor((Math.min(...vals) - 10) / 15) * 15, max: Math.ceil((Math.max(...vals) + 10) / 15) * 15 });
  opts.plugins.tooltip.filter = (c) => c.datasetIndex === 0;
  opts.plugins.tooltip.callbacks = {
    title: (i) => `Week of ${fmtDate(weeks[i[0].dataIndex].start)}`,
    label: (c) => (c.raw == null ? ' No runs' : ` ${paceStr(c.raw)} /km over ${km1(weeks[c.dataIndex].km)} km`),
  };
  const line = (v, color, dash) => ({ data: weeks.map(() => v), borderColor: color, borderDash: dash, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 });
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: weeks.map((w) => fmtDate(w.start)),
      datasets: [
        { label: 'Weekly pace', data: weeks.map((w) => w.pace && Math.round(w.pace)), borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, spanGaps: true, tension: 0.25 },
        line(mp, '#F2F3F5', [6, 4]),
        line(easy, '#8A8F98', [2, 4]),
      ],
    },
    options: opts,
  });
}
