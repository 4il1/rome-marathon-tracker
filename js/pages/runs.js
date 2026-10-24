import { loadRuns } from '../data.js';
import { addDays, fmtDate, km1 } from '../util.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Sequential lime ramp for the calendar: no run, then under 5, 5–10, 10–15 and 15+ km.
const STEPS = [5, 10, 15];
const RAMP = ['#22252B', 'rgba(198,255,0,0.22)', 'rgba(198,255,0,0.42)', 'rgba(198,255,0,0.66)', 'rgba(198,255,0,0.9)'];
const level = (km) => (km <= 0 ? 0 : 1 + STEPS.filter((s) => km >= s).length);

const hms = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const pace = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '–');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let chart;

export async function renderRuns(root) {
  const runs = await loadRuns();
  const years = [...new Set(runs.map((r) => r.date.getFullYear()))].sort((a, b) => b - a);
  let year = years[0];

  root.innerHTML = `
    <h1>Runs</h1>
    <p class="lede">${runs.length} runs since ${fmtDate(runs.at(-1).date, { month: 'long', year: 'numeric' })}</p>
    <div class="chips" role="tablist" aria-label="Year">${years.map((y) => `<button type="button" role="tab" data-year="${y}">${y}</button>`).join('')}</div>
    <div id="year-view"></div>`;

  const chips = root.querySelectorAll('.chips button');
  const show = () => {
    chips.forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.year === year)));
    renderYear(root.querySelector('#year-view'), runs.filter((r) => r.date.getFullYear() === year), year);
  };
  chips.forEach((b) => b.addEventListener('click', () => { year = +b.dataset.year; show(); }));
  show();
}

function renderYear(el, runs, year) {
  const km = runs.reduce((t, r) => t + r.km, 0);
  const secs = runs.reduce((t, r) => t + (r.moving_time_s ?? 0), 0);
  const longest = runs.reduce((a, r) => (r.km > (a?.km ?? 0) ? r : a), null);
  const monthly = MONTHS.map((_, m) => runs.filter((r) => r.date.getMonth() === m).reduce((t, r) => t + r.km, 0));
  const maxKm = Math.max(...runs.map((r) => r.km));

  el.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Runs</div><div class="big">${runs.length}</div></div>
      <div class="card"><div class="label">Distance</div><div class="big">${Math.round(km)}<small>km</small></div></div>
      <div class="card"><div class="label">Time running</div><div class="big">${hms(secs)}</div></div>
      <div class="card"><div class="label">Longest run</div><div class="big">${km1(longest.km)}<small>km</small></div><div class="sub">${fmtDate(longest.date, { day: 'numeric', month: 'short' })}</div></div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Every run in ${year}</h2><div class="muted" style="font-size:13px">One square per day: under 5, 5–10, 10–15 and 15+ km</div></div>
      </div>
      <div class="heatmap-wrap">${heatmap(runs, year)}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Distance by month</h2><div class="muted" style="font-size:13px">km per month in ${year}</div></div></div>
      <div class="chart" style="height:240px"><canvas id="monthly" role="img" aria-label="Bar chart of km per month in ${year}"></canvas></div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Run log</h2><div class="muted" style="font-size:13px">Newest first · bar length shows distance</div></div></div>
      <ol class="run-list">${runs.map((r) => `
        <li>
          <div class="run-date"><b>${fmtDate(r.date, { day: 'numeric', month: 'short' })}</b><span>${fmtDate(r.date, { weekday: 'short' })}</span></div>
          <div class="run-main">
            <div class="run-title">${r.title ?? 'Run'}${r.type === 'Treadmill Running' ? ' <span class="pill">Treadmill</span>' : ''}</div>
            <div class="run-bar"><i style="width:${(r.km / maxKm) * 100}%"></i></div>
          </div>
          <div class="run-stats"><b>${km1(r.km)} km</b><span>${pace(r.avg_pace_s_per_km)} /km${r.avg_hr ? ` · ${r.avg_hr} bpm` : ''}</span></div>
        </li>`).join('')}</ol>
    </section>`;

  drawMonthly(el.querySelector('#monthly'), monthly);
  wireHeatmapTips(el);
}

/** Calendar heatmap: weeks as columns (Monday first), days as rows. */
function heatmap(runs, year) {
  const byDay = {};
  for (const r of runs) byDay[iso(r.date)] = (byDay[iso(r.date)] ?? 0) + r.km;
  const jan1 = new Date(year, 0, 1);
  const start = addDays(jan1, -((jan1.getDay() + 6) % 7)); // Monday on or before 1 Jan
  const cell = 13, gap = 3, top = 18, left = 28;
  const weeks = 53;
  let rects = '', labels = '';
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (day.getFullYear() !== year) continue;
      const km = byDay[iso(day)] ?? 0;
      const tip = `${fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${km ? `${km1(km)} km` : 'no run'}`;
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${RAMP[level(km)]}" data-tip="${tip}"><title>${tip}</title></rect>`;
      if (day.getDate() <= 7 && d === 0) labels += `<text x="${left + w * (cell + gap)}" y="11">${MONTHS[day.getMonth()]}</text>`;
    }
  }
  const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, d) => (t ? `<text x="0" y="${top + d * (cell + gap) + 10}">${t}</text>` : '')).join('');
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  return `<svg class="heatmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Calendar of runs in ${year}">${labels}${dayLabels}${rects}</svg><div class="tip" hidden></div>`;
}

function wireHeatmapTips(el) {
  const wrap = el.querySelector('.heatmap-wrap');
  const tip = wrap.querySelector('.tip');
  wrap.addEventListener('pointerover', (e) => {
    const t = e.target.dataset?.tip;
    if (!t) return;
    tip.textContent = t;
    tip.hidden = false;
    const r = e.target.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    tip.style.left = `${r.left - w.left + wrap.scrollLeft + r.width / 2}px`;
    tip.style.top = `${r.top - w.top - 6}px`;
  });
  wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function drawMonthly(canvas, monthly) {
  const muted = css('--muted'), border = css('--border'), lime = css('--lime');
  chart?.destroy();
  chart = new Chart(canvas, {
    type: 'bar',
    data: { labels: MONTHS, datasets: [{ label: 'Distance', data: monthly.map((x) => +x.toFixed(1)), backgroundColor: lime, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 36 }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1E2127', borderColor: border, borderWidth: 1, padding: 10, displayColors: false, callbacks: { label: (c) => `${c.raw.toFixed(1)} km` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: border }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 6 } },
        y: { beginAtZero: true, grid: { color: border }, border: { display: false }, ticks: { color: muted, callback: (v) => `${v} km` } },
      },
    },
  });
}
