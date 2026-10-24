import { SESSIONS } from '../plan-data.js';
import { PACES } from '../paces.js';
import { CONFIG } from '../config.js';
import { loadRuns, loadDetails, loadRecovery, supabase } from '../data.js';
import { today, addDays, planStart, planWeek, daysBetween, fmtDate, km1, WEEKS } from '../util.js';
import { css, INTENSITY, STATUS, STATUS_ICON, toSec, clock, paceStr, baseOptions, paceAxis, refsPlugin, timeAxis } from '../charts.js';
import { efficiency, routes, isEasy, rolling, monthly, workload, workloadStatus, intensityByWeek, goalPaceKm } from '../metrics.js';

const MARATHON = 42.195;
const timed = (r) => r.moving_time_s && r.km > 0;
const short = (d) => fmtDate(d, { day: 'numeric', month: 'short' });
const long = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const PW_KEY = 'rmb-recovery-pw';

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
const keep = (c) => { charts.push(c); return c; };
const chart = (canvas, config) => keep(new Chart(canvas, { plugins: [refsPlugin], ...config }));

const panel = (id, title, sub, legend = '') => `
  <section class="panel">
    <div class="panel-head"><div><h2>${title}</h2><div class="muted small">${sub}</div></div>${legend ? `<div class="legend">${legend}</div>` : ''}</div>
    <div class="chart"><canvas id="${id}" role="img" aria-label="${title}"></canvas></div>
  </section>`;
const key = (color, label, cls = '') => `<span><i class="${cls}" style="${cls ? `border-color:${color}` : `background:${color}`}"></i>${label}</span>`;

export async function renderAnalysis(root) {
  const [runs, details] = await Promise.all([loadRuns(), loadDetails()]);
  charts.splice(0).forEach((c) => c.destroy());

  root.innerHTML = `
    <h1>Analysis</h1>
    <p class="lede">How training is going, from Garmin data. Detail (splits, heart rate zones, routes) covers runs since January 2025.</p>
    <nav class="chips jump" aria-label="Sections">
      ${[['readiness', 'Marathon readiness'], ['route', 'Same route'], ['fitness', 'Fitness'], ['load', 'Load and balance'], ['recovery', 'Recovery']]
        .map(([id, label]) => `<button type="button" data-jump="${id}">${label}</button>`).join('')}
    </nav>
    <div id="readiness" class="section"></div>
    <div id="route" class="section"></div>
    <div id="fitness" class="section"></div>
    <div id="load" class="section"></div>
    <div id="recovery" class="section"></div>`;
  root.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => root.querySelector(`#${b.dataset.jump}`).scrollIntoView({ behavior: 'smooth' })));

  renderReadiness(root.querySelector('#readiness'), runs, details);
  renderRoutes(root.querySelector('#route'), runs, details);
  renderFitness(root.querySelector('#fitness'), runs, details);
  renderLoad(root.querySelector('#load'), runs, details);
  renderRecovery(root.querySelector('#recovery'));
}

// --- Marathon readiness -------------------------------------------------------------------------

function renderReadiness(el, runs, details) {
  const now = today();
  const goal = toSec(CONFIG.goalTime);
  const recent = runs.filter((r) => timed(r) && r.km >= 10 && daysBetween(r.date, now) <= 84);
  const pred = recent.map((r) => ({ run: r, t: riegel(r.moving_time_s, r.km, MARATHON) })).sort((a, b) => a.t - b.t)[0];
  const vsGoal = pred ? goal - pred.t : 0;
  const pbs = [['5K', 5], ['10K', 10], ['Half marathon', 21.0975]].map(([name, d]) => ({ name, d, ...best(runs, d) }));
  const mpWeeks = goalPaceKm(runs, details, toSec(PACES.MP));
  const mpLast4 = mpWeeks.slice(-4).reduce((t, w) => t + w.km, 0);

  el.innerHTML = `
    <h2 class="section-title">Marathon readiness</h2>
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
        ${p.t ? `<div class="big">${clock(p.t)}</div><div class="sub">${paceStr(p.t / p.d)} /km · ${long(p.run.date)}</div>` : '<div class="big">–</div>'}
      </div>`).join('')}
      <div class="card">
        <div class="label">At goal pace, last 4 weeks</div>
        <div class="big">${km1(mpLast4)}<small>km</small></div>
        <div class="sub">Kilometres within 10 s of ${PACES.MP} /km</div>
      </div>
    </div>
    ${panel('long', 'Long runs', "Your longest run each plan week against the plan's long run",
      key(css('--planned'), 'Planned') + key(css('--lime'), 'Longest run'))}
    ${panel('pace', 'Pace trend', 'Average pace each week for the last 26 weeks · higher is faster',
      key(css('--lime'), 'Weekly pace') + `<span><i class="dash"></i>Marathon pace ${PACES.MP}</span><span><i class="dash easy"></i>Easy ${PACES.easy}</span>`)}
    ${panel('mp', 'Time at goal pace', `Kilometres each week within 10 s of marathon pace (${PACES.MP} /km), from km splits`)}`;

  drawLong(el.querySelector('#long'), runs, now, planWeek(now));
  drawPace(el.querySelector('#pace'), runs, now);

  const opts = baseOptions({ callback: (v) => `${v} km` });
  opts.scales.y.beginAtZero = true;
  opts.plugins.tooltip.callbacks = { title: (i) => `Week of ${short(mpWeeks[i[0].dataIndex].start)}`, label: (c) => ` ${c.raw.toFixed(1)} km at goal pace` };
  chart(el.querySelector('#mp'), {
    type: 'bar',
    data: { labels: mpWeeks.map((w) => short(w.start)), datasets: [{ data: mpWeeks.map((w) => +w.km.toFixed(1)), backgroundColor: css('--lime'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72 }] },
    options: opts,
  });
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
  const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, barPercentage: 0.9 });
  chart(canvas, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week),
      datasets: [
        bar('Planned', weeks.map((w) => +w.planned.toFixed(1)), css('--planned')),
        bar('Longest run', weeks.map((w) => (w.longest == null ? null : +w.longest.toFixed(1))), css('--lime')),
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
  const opts = paceAxis(baseOptions(), weeks.map((w) => w.pace).concat([mp, easy]));
  opts.plugins.refs = { lines: [{ at: mp, color: '#F2F3F5' }, { at: easy, color: '#8A8F98', dash: [2, 4] }] };
  opts.plugins.tooltip.callbacks = {
    title: (i) => `Week of ${fmtDate(weeks[i[0].dataIndex].start)}`,
    label: (c) => (c.raw == null ? ' No runs' : ` ${paceStr(c.raw)} /km over ${km1(weeks[c.dataIndex].km)} km`),
  };
  chart(canvas, {
    type: 'line',
    data: {
      labels: weeks.map((w) => fmtDate(w.start)),
      datasets: [{ label: 'Weekly pace', data: weeks.map((w) => w.pace && Math.round(w.pace)), borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, spanGaps: true, tension: 0.25 }],
    },
    options: opts,
  });
}

// --- Same route ---------------------------------------------------------------------------------

function renderRoutes(el, runs, details) {
  const list = routes(runs, details).slice(0, 5);
  el.innerHTML = `
    <h2 class="section-title">Same route</h2>
    <p class="muted small section-sub">Runs on the same route, found from GPS. Comparing like with like shows real change: same distance, same hills.</p>
    ${list.length ? `<div class="chips" role="tablist" aria-label="Route">${list.map((r, i) => `<button type="button" role="tab" data-route="${i}">${r.name} · ${km1(r.km)} km · ${r.runs.length} runs</button>`).join('')}</div>
    <div id="route-view"></div>` : '<div class="panel muted">No route has been run four or more times since January 2025 yet.</div>'}`;
  if (!list.length) return;

  const routeCharts = [];
  const show = (i) => {
    el.querySelectorAll('[data-route]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.route === i)));
    routeCharts.splice(0).forEach((c) => { c.destroy(); charts.splice(charts.indexOf(c), 1); });
    routeCharts.push(...renderRoute(el.querySelector('#route-view'), list[i], details));
  };
  el.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => show(+b.dataset.route)));
  // Default to the route run most often in the last 8 weeks (e.g. the Tue/Thu 10 km), else the most run.
  const recentCount = (r) => r.runs.filter((x) => daysBetween(x.date, today()) <= 56).length;
  show(list.reduce((bi, r, i) => (recentCount(r) > recentCount(list[bi]) ? i : bi), 0));
}

function renderRoute(el, route, details) {
  const rs = route.runs.filter(timed);
  const fastest = rs.reduce((a, b) => (b.moving_time_s / b.km < a.moving_time_s / a.km ? b : a));
  const latest = rs.at(-1);
  const n = Math.min(3, Math.floor(rs.length / 2));
  const avgPace = (xs) => xs.reduce((t, r) => t + r.moving_time_s / r.km, 0) / xs.length;
  const change = avgPace(rs.slice(0, n)) - avgPace(rs.slice(-n));
  const effs = rs.map((r) => ({ r, e: efficiency(r) })).filter((x) => x.e);
  const effChange = effs.length >= 4 ? ((avg(effs.slice(-n).map((x) => x.e)) / avg(effs.slice(0, n).map((x) => x.e))) - 1) * 100 : null;

  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Runs on this route</div><div class="big">${rs.length}</div><div class="sub">${short(rs[0].date)} – ${short(latest.date)}${route.usualDays.length ? ` · usually ${route.usualDays.join(' and ')}` : ''}</div></div>
      <div class="card"><div class="label">Fastest</div><div class="big">${clock(fastest.moving_time_s)}</div><div class="sub">${paceStr(fastest.moving_time_s / fastest.km)} /km · ${long(fastest.date)}</div></div>
      <div class="card"><div class="label">Latest</div><div class="big ${latest === fastest ? 'lime' : ''}">${clock(latest.moving_time_s)}</div><div class="sub">${paceStr(latest.moving_time_s / latest.km)} /km · ${long(latest.date)}${latest.avg_hr ? ` · ${latest.avg_hr} bpm` : ''}</div></div>
      <div class="card"><div class="label">Pace change</div><div class="big">${Math.abs(Math.round(change))}<small>s/km ${change >= 0 ? 'faster' : 'slower'}</small></div><div class="sub">Last ${n} runs against first ${n}</div></div>
      ${effChange == null ? '' : `<div class="card"><div class="label">Efficiency change</div><div class="big">${effChange >= 0 ? '+' : '−'}${Math.abs(effChange).toFixed(1)}<small>%</small></div><div class="sub">Distance per heartbeat, last ${n} against first ${n}</div></div>`}
    </div>
    <div class="grid-2">
      ${panel('route-pace', 'Pace on this route', 'Each run · higher is faster')}
      ${panel('route-eff', 'Pace for the effort', 'Metres per heartbeat · higher means fitter: faster for the same heart rate')}
    </div>
    ${panel('route-splits', 'Latest against fastest, km by km', `${long(latest.date)} against ${long(fastest.date)} · higher is faster`,
      key(css('--lime'), 'Latest') + key(css('--planned'), 'Fastest'))}`;

  const made = [];
  const labels = rs.map((r) => short(r.date));
  const tipTitle = (i) => `${fmtDate(rs[i[0].dataIndex].date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`;
  const point = (data) => ({ data, borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 4, pointHoverRadius: 7, spanGaps: true, tension: 0 });

  const paces = rs.map((r) => Math.round(r.moving_time_s / r.km));
  const po = paceAxis(baseOptions(), paces);
  po.plugins.tooltip.callbacks = { title: tipTitle, label: (c) => ` ${paceStr(c.raw)} /km · ${clock(rs[c.dataIndex].moving_time_s)}${rs[c.dataIndex].avg_hr ? ` · ${rs[c.dataIndex].avg_hr} bpm` : ''}` };
  made.push(chart(el.querySelector('#route-pace'), { type: 'line', data: { labels, datasets: [point(paces)] }, options: po }));

  const eo = baseOptions({ callback: (v) => v.toFixed(3), maxTicksLimit: 6 });
  eo.plugins.tooltip.callbacks = { title: tipTitle, label: (c) => (c.raw == null ? ' No heart rate' : ` ${c.raw.toFixed(2)} m per beat · ${rs[c.dataIndex].avg_hr} bpm`) };
  made.push(chart(el.querySelector('#route-eff'), { type: 'line', data: { labels, datasets: [point(rs.map((r) => efficiency(r)))] }, options: eo }));

  const sl = details.get(latest.id)?.splits ?? [], sf = details.get(fastest.id)?.splits ?? [];
  const whole = (xs) => xs.filter((s) => s.km >= 0.5);
  const kms = Math.max(whole(sl).length, whole(sf).length);
  const perKm = (s) => (s && s.km >= 0.5 ? Math.round(s.s / s.km) : null);
  const so = paceAxis(baseOptions(), [...sl, ...sf].map(perKm));
  so.plugins.tooltip.callbacks = { title: (i) => `Km ${i[0].dataIndex + 1}`, label: (c) => (c.raw == null ? '' : ` ${c.dataset.label}: ${paceStr(c.raw)} /km`) };
  made.push(chart(el.querySelector('#route-splits'), {
    type: 'line',
    data: {
      labels: Array.from({ length: kms }, (_, i) => `${i + 1}`),
      datasets: [
        { label: 'Latest', data: Array.from({ length: kms }, (_, i) => perKm(sl[i])), borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 4, pointHoverRadius: 7 },
        { label: 'Fastest', data: Array.from({ length: kms }, (_, i) => perKm(sf[i])), borderColor: css('--planned'), backgroundColor: css('--planned'), borderWidth: 2, borderDash: [6, 4], pointRadius: 4, pointHoverRadius: 7 },
      ],
    },
    options: so,
  }));
  return made;
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// --- Fitness ------------------------------------------------------------------------------------

function renderFitness(el, runs, details) {
  const easy = runs.filter((r) => details.has(r.id) && isEasy(details.get(r.id)) && efficiency(r)).sort((a, b) => a.date - b.date);
  const effPoints = easy.map((r) => ({ date: r.date, value: efficiency(r) }));
  const effAvg = rolling(effPoints, 28);
  const longRuns = runs.filter((r) => r.km >= 14 && details.get(r.id)?.drift_pct != null).sort((a, b) => a.date - b.date);
  const form = (f) => monthly(runs.filter((r) => details.get(r.id)?.form?.[f] != null).map((r) => ({ date: r.date, value: details.get(r.id).form[f] })));

  el.innerHTML = `
    <h2 class="section-title">Fitness</h2>
    ${panel('eff', 'Efficiency on easy runs', 'Metres per heartbeat on runs with 70%+ of time in heart rate zones 1–2 · rising means aerobic fitness is improving',
      key('rgba(198,255,0,0.45)', 'Each easy run') + key(css('--lime'), '28-day average'))}
    ${panel('drift', 'Long-run drift', 'Drop in pace-for-heart-rate from the first half to the second half of runs of 14 km+ · under 5% means your endurance holds',
      '<span><i class="dash"></i>5% target</span>')}
    <div class="grid-3">
      ${panel('cadence', 'Cadence', 'Steps per minute, monthly average')}
      ${panel('stride', 'Stride length', 'Metres, monthly average')}
      ${panel('gct', 'Ground contact time', 'Milliseconds, monthly average · lower is better')}
    </div>`;

  const eo = timeAxis(baseOptions({ callback: (v) => v.toFixed(3), maxTicksLimit: 6 }), (d) => fmtDate(d, { month: 'short', year: '2-digit' }));
  eo.plugins.tooltip.callbacks = {
    title: (i) => long(effPoints[i[0].dataIndex].date),
    label: (c) => (c.datasetIndex === 0 ? ` ${c.raw.y.toFixed(3)} m per beat · ${easy[c.dataIndex].km.toFixed(1)} km at ${easy[c.dataIndex].avg_hr} bpm` : ` 28-day average: ${c.raw.y.toFixed(3)}`),
  };
  const xy = (pts) => pts.map((p) => ({ x: +p.date, y: p.value }));
  chart(el.querySelector('#eff'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Each easy run', data: xy(effPoints), showLine: false, pointRadius: 4, pointHoverRadius: 7, backgroundColor: 'rgba(198,255,0,0.45)', borderColor: 'rgba(198,255,0,0.45)' },
        { label: '28-day average', data: xy(effAvg), borderColor: css('--lime'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, tension: 0 },
      ],
    },
    options: eo,
  });

  const d = baseOptions({ callback: (v) => `${v}%` });
  d.plugins.refs = { lines: [{ at: 5, color: '#F2F3F5', label: '5%' }] };
  d.plugins.tooltip.callbacks = { title: (i) => long(longRuns[i[0].dataIndex].date), label: (c) => ` ${c.raw}% drift · ${longRuns[c.dataIndex].km.toFixed(1)} km` };
  chart(el.querySelector('#drift'), {
    type: 'bar',
    data: { labels: longRuns.map((r) => short(r.date)), datasets: [{ data: longRuns.map((r) => details.get(r.id).drift_pct), backgroundColor: css('--lime'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, maxBarThickness: 28 }] },
    options: d,
  });

  const small = (id, points, fmt, unit) => {
    const o = baseOptions({ callback: (v) => fmt(v), maxTicksLimit: 5 });
    o.plugins.tooltip.callbacks = { title: (i) => fmtDate(points[i[0].dataIndex].date, { month: 'long', year: 'numeric' }), label: (c) => ` ${fmt(c.raw)} ${unit}` };
    chart(el.querySelector(`#${id}`), {
      type: 'line',
      data: { labels: points.map((p) => fmtDate(p.date, { month: 'short' })), datasets: [{ data: points.map((p) => p.value), borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.25 }] },
      options: o,
    });
  };
  small('cadence', form('cadence'), (v) => Math.round(v), 'spm');
  small('stride', form('stride_m'), (v) => v.toFixed(2), 'm');
  small('gct', form('gct_ms'), (v) => Math.round(v), 'ms');
}

// --- Load and balance ---------------------------------------------------------------------------

function renderLoad(el, runs, details) {
  const days = workload(runs);
  const now = days.at(-1);
  const status = workloadStatus(now.ratio);
  const weeks = intensityByWeek(runs, details);
  const recent = weeks.slice(-4).filter((w) => w.easy != null);
  const easyShare = recent.length ? recent.reduce((t, w) => t + w.easy * w.minutes, 0) / recent.reduce((t, w) => t + w.minutes, 0) : null;

  el.innerHTML = `
    <h2 class="section-title">Load and balance</h2>
    <div class="cards">
      <div class="card">
        <div class="label">Training load ratio
          <span class="info">
            <button type="button" class="info-btn" aria-label="What the training load ratio means" aria-describedby="load-info">i</button>
            <span class="info-body" role="tooltip" id="load-info">
              <b class="info-title">What the training load ratio means</b>
              <span class="info-p">It compares your last 7 days with what your body is used to: your average week over the last 4. Fitness improves quickly, but tendons, joints and bones adapt more slowly, so a sudden jump in distance is the most common cause of running injuries.</span>
              <span class="info-list">
                <span class="info-li"><b>0.8–1.3:</b> building safely.</span>
                <span class="info-li"><b>1.3–1.5:</b> rising fast. Fine for a week, such as a race week, but hold steady after it.</span>
                <span class="info-li"><b>Above 1.5:</b> high injury risk. Ease off for a few days.</span>
                <span class="info-li"><b>Below 0.8:</b> lighter than usual, as in a taper or a rest week.</span>
              </span>
              ${now.ratio != null && now.ratio > 1.3 ? `<span class="info-p"><b>Now:</b> ${km1(now.acute)} km in 7 days against a usual ${km1(now.chronic)} km. To get back under 1.3, keep your rolling 7 days to about ${Math.round(now.chronic * 1.3)} km.</span>` : ''}
            </span>
          </span>
        </div>
        <div class="big">${now.ratio == null ? '–' : now.ratio.toFixed(2)}</div>
        <div class="status" style="--status:${STATUS[status.key]}"><span aria-hidden="true">${STATUS_ICON[status.key]}</span>${status.label}</div>
      </div>
      <div class="card"><div class="label">Last 7 days</div><div class="big">${km1(now.acute)}<small>km</small></div><div class="sub">Against ${km1(now.chronic)} km in an average week of the last 4</div></div>
      <div class="card"><div class="label">Easy share, last 4 weeks</div><div class="big">${easyShare == null ? '–' : Math.round(easyShare)}<small>%</small></div><div class="sub">Of heart rate time in zones 1–2 · aim for about 80%</div></div>
    </div>
    ${panel('acwr', 'Training load ratio', 'Km in the last 7 days against your average week over the last 28 · 0.8–1.3 is the safe range; above 1.5 raises injury risk',
      `<span><i style="background:rgba(198,255,0,0.14)"></i>Safe range</span><span><i class="dash" style="border-color:${STATUS.critical}"></i>1.5 high risk</span>`)}
    ${panel('intensity', 'Easy and hard each week', 'Share of heart rate time by zone, last 16 weeks · the line marks 80% easy',
      key(INTENSITY[0], 'Easy (zones 1–2)') + key(INTENSITY[1], 'Moderate (zone 3)') + key(INTENSITY[2], 'Hard (zones 4–5)'))}`;

  const a = baseOptions({ callback: (v) => v.toFixed(1) });
  a.scales.y.min = 0;
  a.scales.y.suggestedMax = 2;
  a.plugins.refs = { bands: [{ from: 0.8, to: 1.3, color: 'rgba(198,255,0,0.10)' }], lines: [{ at: 1.5, color: STATUS.critical, label: '1.5' }] };
  a.plugins.tooltip.callbacks = { title: (i) => long(days[i[0].dataIndex].date), label: (c) => (c.raw == null ? ' –' : ` Ratio ${c.raw.toFixed(2)} · ${km1(days[c.dataIndex].acute)} km in 7 days`) };
  chart(el.querySelector('#acwr'), {
    type: 'line',
    data: { labels: days.map((x) => short(x.date)), datasets: [{ data: days.map((x) => x.ratio), borderColor: css('--lime'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: css('--lime'), tension: 0.2 }] },
    options: a,
  });

  const o = baseOptions({ callback: (v) => `${v}%` });
  o.scales.x.stacked = true;
  Object.assign(o.scales.y, { stacked: true, min: 0, max: 100 });
  o.plugins.refs = { lines: [{ at: 80, color: '#F2F3F5', label: '80% easy' }] };
  o.plugins.tooltip.callbacks = {
    title: (i) => `Week of ${short(weeks[i[0].dataIndex].start)} · ${Math.round(weeks[i[0].dataIndex].minutes)} min`,
    label: (c) => (c.raw == null ? '' : ` ${c.dataset.label}: ${Math.round(c.raw)}%`),
  };
  // A 2px surface gap between stacked segments.
  const seg = (label, f, color) => ({ label, data: weeks.map((w) => (w[f] == null ? null : +w[f].toFixed(1))), backgroundColor: color, borderColor: css('--surface'), borderWidth: { top: 2 }, borderSkipped: false, categoryPercentage: 0.72 });
  chart(el.querySelector('#intensity'), {
    type: 'bar',
    data: { labels: weeks.map((w) => short(w.start)), datasets: [seg('Easy', 'easy', INTENSITY[0]), seg('Moderate', 'moderate', INTENSITY[1]), seg('Hard', 'hard', INTENSITY[2])] },
    options: o,
  });
}

// --- Recovery (password) ------------------------------------------------------------------------

function renderRecovery(el) {
  el.innerHTML = `
    <h2 class="section-title">Recovery</h2>
    <div id="recovery-body"></div>`;
  const body = el.querySelector('#recovery-body');
  let saved = null;
  try { saved = sessionStorage.getItem(PW_KEY); } catch { /* storage blocked */ }
  if (saved) unlock(body, saved, true); else lockForm(body);
}

function lockForm(body, message = '') {
  body.innerHTML = `
    <form class="panel lock" novalidate>
      <div><h2>Locked</h2><div class="muted small">Sleep, heart rate variability and Body Battery are private. Enter the viewer password to see them.</div></div>
      <label for="recovery-pw" class="sr-only">Viewer password</label>
      <div class="lock-row">
        <input id="recovery-pw" type="password" autocomplete="current-password" placeholder="Viewer password" required>
        <button class="btn primary" type="submit">Unlock</button>
      </div>
      <p class="field-error" role="alert" ${message ? '' : 'hidden'}>${message}</p>
    </form>`;
  body.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = body.querySelector('#recovery-pw').value;
    if (pw) unlock(body, pw, false);
  });
}

async function unlock(body, pw, fromSaved) {
  const since = addDays(today(), -120);
  const iso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  let res;
  try { res = await loadRecovery(pw, iso); } catch (e) {
    // No valid visitor session (it lapsed or was cleared): the human check has to run again.
    if (e.code === '42501' || /JWT|permission denied/i.test(e.message)) {
      body.innerHTML = '<div class="panel">Your visit has expired. <button class="btn primary" type="button" id="again">Reload and check again</button></div>';
      body.querySelector('#again').addEventListener('click', async () => { await supabase.auth.signOut({ scope: 'local' }); location.reload(); });
      return;
    }
    return lockForm(body, `Couldn't load recovery data: ${e.message}`);
  }
  if (!res.ok) {
    try { sessionStorage.removeItem(PW_KEY); } catch { /* storage blocked */ }
    return lockForm(body, fromSaved ? '' : res.reason === 'locked' ? 'Too many wrong passwords. Try again in an hour.' : 'Wrong password.');
  }
  try { sessionStorage.setItem(PW_KEY, pw); } catch { /* storage blocked */ }

  const rows = res.rows.map((r) => ({ ...r, date: new Date(`${r.day}T00:00:00`) }));
  const last = rows.filter((r) => r.hrv_night != null).at(-1) ?? rows.at(-1);
  body.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">HRV last night</div><div class="big">${last?.hrv_night ?? '–'}<small>ms</small></div><div class="sub">${last?.hrv_status ? `${last.hrv_status.toLowerCase()} · ` : ''}7-day ${last?.hrv_week ?? '–'} ms</div></div>
      <div class="card"><div class="label">Resting heart rate</div><div class="big">${last?.resting_hr ?? '–'}<small>bpm</small></div><div class="sub">${last ? long(last.date) : ''}</div></div>
      <div class="card"><div class="label">Sleep</div><div class="big">${last?.sleep_s ? (last.sleep_s / 3600).toFixed(1) : '–'}<small>h</small></div><div class="sub">Score ${last?.sleep_score ?? '–'}</div></div>
      <div class="card"><div class="label">Body Battery charged</div><div class="big">${last?.bb_charged ?? '–'}</div><div class="sub">Overnight recharge</div></div>
    </div>
    <p class="muted small section-sub">Last 120 days. Garmin has overnight data (sleep, HRV, Body Battery) from late July 2026.</p>
    <div class="grid-2">
      ${panel('hrv', 'Heart rate variability', 'Nightly average, ms · higher usually means better recovered')}
      ${panel('rhr', 'Resting heart rate', 'bpm · a rise of 5+ above normal can signal fatigue or illness')}
      ${panel('sleep', 'Sleep', 'Hours per night')}
      ${panel('bb', 'Body Battery charged', 'Points recharged each day')}
    </div>`;

  const labels = rows.map((r) => short(r.date));
  const tip = (unit, f = (v) => v) => ({ title: (i) => long(rows[i[0].dataIndex].date), label: (c) => (c.raw == null ? ' –' : ` ${f(c.raw)} ${unit}`) });
  const line = (id, field, unit) => {
    const o = baseOptions({ maxTicksLimit: 5 });
    o.plugins.tooltip.callbacks = tip(unit);
    chart(body.querySelector(`#${id}`), { type: 'line', data: { labels, datasets: [{ data: rows.map((r) => r[field]), borderColor: css('--lime'), backgroundColor: css('--lime'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, spanGaps: true, tension: 0.25 }] }, options: o });
  };
  const bars = (id, values, unit, f) => {
    const o = baseOptions({ maxTicksLimit: 5 });
    o.scales.y.beginAtZero = true;
    o.plugins.tooltip.callbacks = tip(unit, f);
    chart(body.querySelector(`#${id}`), { type: 'bar', data: { labels, datasets: [{ data: values, backgroundColor: css('--lime'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.8 }] }, options: o });
  };
  line('hrv', 'hrv_night', 'ms');
  line('rhr', 'resting_hr', 'bpm');
  bars('sleep', rows.map((r) => (r.sleep_s ? +(r.sleep_s / 3600).toFixed(2) : null)), 'h', (v) => v.toFixed(1));
  bars('bb', rows.map((r) => r.bb_charged), 'points');
}
