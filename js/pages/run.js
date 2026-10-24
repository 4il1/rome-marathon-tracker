import { loadRuns, loadRunDetail } from '../data.js';
import { fmtDate, km1 } from '../util.js';
import { css, clock, paceStr, baseOptions } from '../charts.js';

// Map line colour, slow -> fast (or low -> high heart rate): one hue, validated as an ordinal ramp
// against the dark map tiles and the panel surface.
const RAMP = ['#5A7800', '#7A9F00', '#99C400', '#B3E300', '#D4FF4D'];
const ZONES = ['Zone 1 · Warm up', 'Zone 2 · Easy', 'Zone 3 · Aerobic', 'Zone 4 · Threshold', 'Zone 5 · Maximum'];
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4';

let leafletReady;
function loadLeaflet() {
  leafletReady ??= new Promise((resolve, reject) => {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${LEAFLET}/leaflet.min.css` });
    const s = Object.assign(document.createElement('script'), { src: `${LEAFLET}/leaflet.min.js` });
    s.onload = () => resolve(window.L);
    s.onerror = () => { leafletReady = undefined; reject(new Error('The map could not load.')); };
    document.head.append(link, s);
  });
  return leafletReady;
}

const charts = [];
let map;

export async function renderRun(root, id) {
  charts.splice(0).forEach((c) => c.destroy());
  map?.remove(); map = null;

  const runs = await loadRuns();
  const run = runs.find((r) => String(r.id) === id);
  if (!run) { root.innerHTML = '<a class="back" href="#runs">← Runs</a><div class="empty">Run not found.</div>'; return; }
  const d = await loadRunDetail(run.id);

  const pace = run.moving_time_s ? run.moving_time_s / run.km : null;
  const te = d?.training_effect;
  root.innerHTML = `
    <a class="back" href="#runs">← Runs</a>
    <h1>${run.title ?? 'Run'}</h1>
    <p class="lede">${fmtDate(run.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${run.start_time.slice(11, 16)}${run.type && run.type !== 'Running' ? ` · ${run.type}` : ''}</p>
    <div class="cards">
      <div class="card"><div class="label">Distance</div><div class="big">${run.km.toFixed(2)}<small>km</small></div></div>
      <div class="card"><div class="label">Moving time</div><div class="big">${run.moving_time_s ? clock(run.moving_time_s) : '–'}</div></div>
      <div class="card"><div class="label">Pace</div><div class="big">${pace ? paceStr(pace) : '–'}<small>/km</small></div></div>
      <div class="card"><div class="label">Heart rate</div><div class="big">${run.avg_hr ?? '–'}<small>bpm</small></div><div class="sub">${run.max_hr ? `Max ${run.max_hr}` : ''}</div></div>
      <div class="card"><div class="label">Climb</div><div class="big">${run.elevation_m == null ? '–' : Math.round(run.elevation_m)}<small>m</small></div></div>
      ${te?.aerobic != null ? `<div class="card"><div class="label">Training effect</div><div class="big">${te.aerobic.toFixed(1)}</div><div class="sub">Aerobic · anaerobic ${te.anaerobic?.toFixed(1) ?? '–'}</div></div>` : ''}
    </div>
    ${d ? detailHtml(d) : '<div class="panel muted">Map, splits and charts are available for runs since January 2025 with a Garmin activity file.</div>'}`;
  if (!d) return;

  const hover = { km: null, marker: null };
  drawStreams(root, d, hover);
  if (d.track) drawMap(root, d, hover).catch((e) => { root.querySelector('#map').innerHTML = `<div class="empty">${e.message}</div>`; });
}

function detailHtml(d) {
  const splits = d.splits ?? [];
  const whole = splits.filter((s) => s.km >= 0.5);
  const fastest = whole.reduce((b, s) => (!b || s.s / s.km < b.s / b.km ? s : b), null);
  const slowestPace = Math.max(...whole.map((s) => s.s / s.km)), fastestPace = Math.min(...whole.map((s) => s.s / s.km));
  // Bar length shows speed relative to this run's slowest and fastest km (never zero length).
  const barPct = (s) => 30 + 70 * ((slowestPace - s.s / s.km) / (slowestPace - fastestPace || 1));
  const zoneTotal = (d.hr_zone_s ?? []).reduce((a, b) => a + b, 0);
  const f = d.form ?? {};
  const formTiles = [
    ['Cadence', f.cadence, 'spm', 0], ['Stride length', f.stride_m, 'm', 2], ['Ground contact', f.gct_ms, 'ms', 0],
    ['Vertical oscillation', f.vo_mm == null ? null : f.vo_mm / 10, 'cm', 1], ['Vertical ratio', f.vr_pct, '%', 1],
    ['Heart rate drift', d.drift_pct == null ? null : Number(d.drift_pct), '%', 1],
  ].filter(([, v]) => v != null);

  return `
    ${d.track ? `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Route</h2><div class="muted small">First and last 300 m hidden for privacy · hover the charts below to follow the run</div></div>
        <div class="chips map-mode" role="tablist" aria-label="Colour the route by">
          <button type="button" role="tab" data-mode="pace" aria-selected="true">Pace</button>
          <button type="button" role="tab" data-mode="hr" aria-selected="false">Heart rate</button>
        </div>
      </div>
      <div id="map" class="map"></div>
      <div class="ramp-legend" id="map-legend"></div>
    </section>` : ''}

    <section class="panel">
      <div class="panel-head"><div><h2>Over the run</h2><div class="muted small">By distance${d.track ? ' · hover to see the point on the map' : ''}</div></div></div>
      <div class="stream"><div class="stream-label">Pace</div><div class="chart stream-chart"><canvas id="s-pace" role="img" aria-label="Pace over distance"></canvas></div></div>
      <div class="stream"><div class="stream-label">Heart rate</div><div class="chart stream-chart"><canvas id="s-hr" role="img" aria-label="Heart rate over distance"></canvas></div></div>
      <div class="stream"><div class="stream-label">Elevation</div><div class="chart stream-chart"><canvas id="s-alt" role="img" aria-label="Elevation over distance"></canvas></div></div>
    </section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div><h2>Splits</h2><div class="muted small">Each kilometre · bar length shows relative speed</div></div></div>
        <table class="splits">
          <thead><tr><th>Km</th><th>Pace</th><th class="bar-col"><span class="sr-only">Speed</span></th><th>HR</th><th>Climb</th></tr></thead>
          <tbody>${splits.map((s, i) => `
            <tr>
              <td>${s.km >= 0.99 ? i + 1 : s.km.toFixed(2)}</td>
              <td><b>${paceStr(s.s / s.km)}</b>${s === fastest ? ' <span class="pill">Fastest</span>' : ''}</td>
              <td class="bar-col">${s.km >= 0.5 ? `<div class="split-bar"><i style="width:${barPct(s)}%"></i></div>` : ''}</td>
              <td>${s.hr ?? '–'}</td>
              <td class="muted">+${s.up ?? 0} / −${s.down ?? 0}</td>
            </tr>`).join('')}</tbody>
        </table>
      </section>
      <div>
        ${zoneTotal ? `
        <section class="panel">
          <div class="panel-head"><div><h2>Heart rate zones</h2><div class="muted small">Time in each Garmin zone</div></div></div>
          <ul class="zones">${d.hr_zone_s.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => `
            <li><span>${ZONES[i]}</span><div class="split-bar"><i style="width:${(s / zoneTotal) * 100}%"></i></div><b>${clock(s)}</b><span class="muted">${Math.round((s / zoneTotal) * 100)}%</span></li>`).join('')}
          </ul>
        </section>` : ''}
        ${formTiles.length ? `
        <section class="panel">
          <div class="panel-head"><div><h2>Running form</h2><div class="muted small">Averages for the run${d.drift_pct != null ? ' · drift under 5% means your heart rate held steady' : ''}</div></div></div>
          <div class="form-grid">${formTiles.map(([k, v, u, dp]) => `<div><span class="muted small">${k}</span><b>${v.toFixed(dp)}<small> ${u}</small></b></div>`).join('')}</div>
        </section>` : ''}
      </div>
    </div>`;
}

// --- Charts over distance -----------------------------------------------------------------------

const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const km = chart.$hover?.km;
    if (km == null) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    const px = x.getPixelForValue(km);
    if (px < a.left || px > a.right) return;
    ctx.save(); ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore();
  },
};

function drawStreams(root, d, hover) {
  const s = d.stream ?? { d: [] };
  const km = s.d.map((m) => m / 1000);
  const pts = (ys) => km.map((x, i) => ({ x, y: ys[i] ?? null }));
  const paceS = (s.v ?? []).map((v) => (v && v > 1 ? 1000 / v : null)); // under 1 m/s is walking or stopped
  const made = [];
  const make = (id, data, opts, fill = false) => {
    opts.scales.x = { ...opts.scales.x, type: 'linear', min: 0, max: km.at(-1), ticks: { ...opts.scales.x.ticks, stepSize: 1, callback: (v) => (Number.isInteger(v) ? `${v} km` : '') } };
    opts.scales.y.afterFit = (scale) => { scale.width = 52; }; // same width on all three, so the km line up
    opts.interaction = { mode: 'nearest', axis: 'x', intersect: false };
    opts.onHover = (_e, _els, c) => {
      const x = c.scales.x.getValueForPixel(_e.x);
      hover.km = x >= 0 && x <= km.at(-1) ? x : null;
      made.forEach((m) => m !== c && m.draw());
      moveMarker(hover, d.track);
    };
    const c = new Chart(root.querySelector(`#${id}`), {
      type: 'line',
      plugins: [crosshair],
      data: { datasets: [{ data, borderColor: css('--lime'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: css('--lime'), spanGaps: false, tension: 0.2, fill: fill ? 'start' : false, backgroundColor: 'rgba(198,255,0,0.10)' }] },
      options: opts,
    });
    c.$hover = hover; // shared hover state, read by the crosshair plugin
    charts.push(c); made.push(c);
    c.canvas.addEventListener('mouseleave', () => { hover.km = null; made.forEach((m) => m.draw()); moveMarker(hover, d.track); });
  };
  const tipTitle = (i) => `${i[0].parsed.x.toFixed(2)} km`;

  const vals = paceS.filter((v) => v != null).sort((a, b) => a - b);
  const po = baseOptions({ callback: (v) => paceStr(v), maxTicksLimit: 4 });
  // Clip the axis to the 5th-95th percentile so a finish sprint, a stop or a GPS spike does not flatten the line.
  const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.95)];
  const step = hi - lo > 150 ? 60 : 30;
  Object.assign(po.scales.y, { reverse: true, min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step });
  Object.assign(po.scales.y.ticks, { stepSize: step, maxTicksLimit: undefined });
  po.plugins.tooltip.callbacks = { title: tipTitle, label: (c) => ` ${paceStr(c.parsed.y)} /km` };
  make('s-pace', pts(paceS), po);

  const ho = baseOptions({ maxTicksLimit: 4 });
  ho.plugins.tooltip.callbacks = { title: tipTitle, label: (c) => ` ${c.parsed.y} bpm` };
  make('s-hr', pts(s.hr ?? []), ho);

  const ao = baseOptions({ callback: (v) => `${Math.round(v)} m`, maxTicksLimit: 4 });
  ao.plugins.tooltip.callbacks = { title: tipTitle, label: (c) => ` ${Math.round(c.parsed.y)} m` };
  make('s-alt', pts(s.alt ?? []), ao, true);
  return made;
}

// --- Map ----------------------------------------------------------------------------------------

async function drawMap(root, d, hover) {
  const L = await loadLeaflet();
  const el = root.querySelector('#map');
  if (!el) return;
  map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  // OpenStreetMap's standard tiles (attribution required), darkened in CSS (.map .leaflet-tile-pane).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const track = d.track;
  map.fitBounds(L.latLngBounds(track.map(([la, ln]) => [la, ln])), { padding: [16, 16] });
  const layer = L.layerGroup().addTo(map);
  hover.map = { L, map };

  const draw = (mode) => {
    layer.clearLayers();
    // Pace in s/km from speed (cm/s); heart rate as is. Classes are this run's quintiles.
    const value = (p) => (mode === 'pace' ? (p[3] > 100 ? 100000 / p[3] : null) : p[4] || null);
    const vals = track.map(value).filter((v) => v != null).sort((a, b) => a - b);
    const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(vals.length * q)]);
    // Faster pace (smaller s/km) and higher heart rate get the brighter steps.
    const cls = (v) => { if (v == null) return 0; const k = cuts.filter((c) => v >= c).length; return mode === 'pace' ? 4 - k : k; };
    let run = [track[0]], c = cls(value(track[0]));
    const flush = () => run.length > 1 && L.polyline(run.map(([la, ln]) => [la, ln]), { color: RAMP[c], weight: 5, opacity: 0.95 }).addTo(layer);
    for (let i = 1; i < track.length; i++) {
      const k = cls(value(track[i]));
      run.push(track[i]);
      if (k !== c) { flush(); run = [track[i]]; c = k; }
    }
    flush();
    const fmt = (v) => (mode === 'pace' ? paceStr(v) : Math.round(v));
    const ends = mode === 'pace' ? [`${fmt(vals.at(-1))} /km`, `${fmt(vals[0])} /km`] : [`${fmt(vals[0])} bpm`, `${fmt(vals.at(-1))} bpm`];
    root.querySelector('#map-legend').innerHTML = `<span>${mode === 'pace' ? 'Slower' : 'Lower'} · ${ends[0]}</span><i>${RAMP.map((r) => `<b style="background:${r}"></b>`).join('')}</i><span>${ends[1]} · ${mode === 'pace' ? 'Faster' : 'Higher'}</span>`;
  };
  draw('pace');
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    draw(b.dataset.mode);
  }));
}

function moveMarker(hover, track) {
  if (!hover.map || !track) return;
  const { L, map: m } = hover.map;
  const metres = hover.km == null ? null : hover.km * 1000;
  // Points inside the hidden first and last 300 m have no position.
  const p = metres == null || metres < track[0][2] || metres > track.at(-1)[2] ? null : track.reduce((b, x) => (Math.abs(x[2] - metres) < Math.abs(b[2] - metres) ? x : b));
  if (!p) { hover.marker?.remove(); hover.marker = null; return; }
  if (!hover.marker) hover.marker = L.circleMarker([p[0], p[1]], { radius: 7, color: '#0E0F12', weight: 2, fillColor: '#F2F3F5', fillOpacity: 1 }).addTo(m);
  else hover.marker.setLatLng([p[0], p[1]]);
}
