// Shared chart settings and formats (Chart.js is loaded globally in index.html).

export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Single series and "this run" use the site lime; a reference series (plan, best, average) uses the
// muted --planned grey. Lime is too light to pair with another hue, so two-series charts use lime + grey.
// Intensity ramp, easy -> hard: one hue, validated as an ordinal ramp on the dark surface.
export const INTENSITY = ['#4F6B00', '#8CB800', '#C6FF00'];
// Status colours: always shown with an icon and a label, never colour alone.
export const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b', low: '#8A8F98', none: '#8A8F98' };
export const STATUS_ICON = { good: '✓', warning: '!', critical: '▲', low: '↓', none: '–' };

export const toSec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
export const clock = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };
export const paceStr = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function baseOptions(yTicks = {}) {
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

/** Pace axis: faster at the top, ticks every 15 s, padded around the data. */
export function paceAxis(opts, values) {
  const v = values.filter((x) => x != null);
  Object.assign(opts.scales.y, {
    reverse: true,
    min: Math.floor((Math.min(...v) - 10) / 15) * 15,
    max: Math.ceil((Math.max(...v) + 10) / 15) * 15,
    ticks: { ...opts.scales.y.ticks, stepSize: 15, callback: (x) => paceStr(x) },
  });
  return opts;
}

/**
 * Reference bands and lines behind the data: options.plugins.refs = { bands: [{ from, to, color }],
 * lines: [{ at, color, dash, label }] } in y-axis units.
 */
export const refsPlugin = {
  id: 'refs',
  beforeDatasetsDraw(chart, _args, o) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    if (!o || !y) return;
    ctx.save();
    for (const b of o.bands ?? []) {
      const top = Math.max(a.top, Math.min(y.getPixelForValue(b.to), y.getPixelForValue(b.from)));
      const bottom = Math.min(a.bottom, Math.max(y.getPixelForValue(b.to), y.getPixelForValue(b.from)));
      ctx.fillStyle = b.color;
      ctx.fillRect(a.left, top, a.width, bottom - top);
    }
    for (const l of o.lines ?? []) {
      const py = y.getPixelForValue(l.at);
      if (py < a.top || py > a.bottom) continue;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash(l.dash ?? [6, 4]);
      ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
    }
    ctx.restore();
  },
  // Labels go on top of the data so bars never hide them.
  afterDatasetsDraw(chart, _args, o) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    if (!o || !y) return;
    ctx.save();
    ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    for (const l of o.lines ?? []) {
      const py = y.getPixelForValue(l.at);
      if (!l.label || py < a.top || py > a.bottom) continue;
      const w = ctx.measureText(l.label).width;
      ctx.fillStyle = 'rgba(22,24,29,0.85)';
      ctx.fillRect(a.right - w - 8, py - 17, w + 6, 15);
      ctx.fillStyle = css('--text');
      ctx.fillText(l.label, a.right - 4, py - 3);
    }
    ctx.restore();
  },
};

/** A date x-axis spaced by real time (Chart.js has no date adapter loaded, so it is linear in ms). */
export function timeAxis(opts, fmt) {
  opts.scales.x = { ...opts.scales.x, type: 'linear', ticks: { ...opts.scales.x.ticks, maxTicksLimit: 8, callback: (v) => fmt(new Date(v)) } };
  opts.interaction = { mode: 'nearest', axis: 'x', intersect: false };
  return opts;
}
