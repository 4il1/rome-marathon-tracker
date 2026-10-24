import { CONFIG } from '../config.js';
import { loadRuns, likeCount, hasLiked, addLike } from '../data.js';
import { today, raceDate, planStart, daysBetween, planWeek, weeklyTotals, fmtDate, addDays, km1, WEEKS } from '../util.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const STRAVA = '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FC4C02" stroke="none" d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>';
const BAA = '<img class="badge" src="assets/baa-logo.png" alt="" width="30" height="30">';
const PDF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3 5 6.4 5c2 0 3.6 1.3 4.4 2.5h2.4C14 6.3 15.6 5 17.6 5 21 5 22.7 8.4 21.2 11.4 19 15.6 12 20 12 20z"/></svg>';
const ext = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

export async function renderHome(root) {
  const runs = await loadRuns();
  const now = today();
  const weeks = weeklyTotals(runs);
  const current = planWeek(now); // 0 = before plan, 21 = after

  // Countdown
  const daysLeft = Math.max(0, daysBetween(now, raceDate));
  const w = Math.floor(daysLeft / 7), d = daysLeft % 7;

  // Plan to date: completed weeks plus the current week so far
  const toDate = weeks.filter((x) => x.start <= now);
  const plannedToDate = toDate.reduce((t, x) => t + x.planned, 0);
  const actualToDate = toDate.reduce((t, x) => t + x.actual, 0);
  const pct = plannedToDate ? Math.round((actualToDate / plannedToDate) * 100) : 0;

  const thisWeek = weeks[Math.min(Math.max(current, 1), WEEKS) - 1];
  const daysToStart = daysBetween(now, planStart);

  root.innerHTML = `
    <header class="hero">
      <video class="hero-video" poster="assets/hero-poster.jpg" muted loop playsinline preload="auto" aria-hidden="true"></video>
      <div class="hero-text">
        <h1>Rome Marathon Build</h1>
        <p class="lede">${fmtDate(raceDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div class="hero-actions">
        <button class="like" id="like" type="button" aria-pressed="false">${HEART}<span class="like-label">Like</span><span class="like-count" aria-live="polite"></span></button>
      </div>
    </header>

    <div class="cards">
      <div class="card">
        <div class="label">Time to race</div>
        <div class="big lime">${w}<small>weeks</small> ${d}<small>days</small></div>
        <div class="sub">${daysLeft} days in total</div>
      </div>
      <div class="card">
        <div class="label">Plan to date</div>
        ${current === 0
          ? `<div class="big">${daysToStart}<small>days</small></div><div class="sub">until week 1 starts on ${fmtDate(planStart, { weekday: 'short', day: 'numeric', month: 'short' })}</div>`
          : `<div class="big">${km1(actualToDate)}<small>/ ${km1(plannedToDate)} km</small></div><div class="sub">${pct}% of planned distance</div>
             <div class="bar"><i style="width:${Math.min(pct, 100)}%"></i></div>`}
      </div>
      <div class="card">
        <div class="label">${current === 0 ? 'Week 1' : current > WEEKS ? 'Plan complete' : `This week · week ${current}`}</div>
        <div class="big">${km1(thisWeek.actual)}<small>/ ${km1(thisWeek.planned)} km</small></div>
        <div class="sub">${fmtDate(thisWeek.start)} – ${fmtDate(addDays(thisWeek.end, -1))}</div>
        <div class="bar"><i style="width:${Math.min(100, (thisWeek.actual / thisWeek.planned) * 100 || 0)}%"></i></div>
      </div>
      <div class="card strava-card">
        <div class="strava-head">
          <img class="strava-avatar" src="assets/strava-profile.png" alt="" width="32" height="32">
          <div class="label">${STRAVA} On Strava</div>
          <a class="follow" href="${CONFIG.links.strava}" target="_blank" rel="noopener">Follow ${ext}</a>
        </div>
        ${latestRunHtml(runs[0])}
      </div>
    </div>

    <div class="links">
      <a class="btn logo-btn" href="${CONFIG.links.rome}" target="_blank" rel="noopener"><img src="assets/rome-marathon-logo.webp" alt="Run Rome The Marathon" height="36"> ${ext}</a>
      <a class="btn" href="${CONFIG.links.baa}" target="_blank" rel="noopener">${BAA} B.A.A. training plans ${ext}</a>
      <a class="btn" href="${matchMedia('(max-width: 760px)').matches ? 'assets/docs/marathon-plan-km-mobile.pdf' : 'assets/docs/marathon-plan-km.pdf'}" target="_blank" rel="noopener">${PDF} Plan in km (PDF)</a>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>Weekly distance</h2><div class="muted" style="font-size:13px">Planned against actual, km per plan week</div></div>
        <div class="legend"><span><i style="background:${css('--planned')}"></i>Planned</span><span><i style="background:${css('--lime')}"></i>Actual</span></div>
      </div>
      <div class="chart"><canvas id="weekly" aria-label="Bar chart of planned and actual km for each of the 20 plan weeks" role="img"></canvas></div>
      <details>
        <summary>Show as table</summary>
        <table class="data">
          <thead><tr><th>Week</th><th class="hide-sm">Dates</th><th>Planned</th><th>Actual</th><th>Difference</th></tr></thead>
          <tbody>${weeks.map((x) => {
            const diff = x.actual - x.planned;
            const show = x.start <= now;
            return `<tr class="${x.week === current ? 'now' : ''}"><td>${x.week}</td><td class="hide-sm">${fmtDate(x.start)} – ${fmtDate(addDays(x.end, -1))}</td>
              <td>${km1(x.planned)}</td><td>${show ? km1(x.actual) : '–'}</td>
              <td class="${show ? (diff >= 0 ? 'pos' : 'neg') : ''}">${show ? (diff >= 0 ? '+' : '') + km1(diff) : '–'}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </details>
    </section>`;

  drawWeekly(root.querySelector('#weekly'), weeks, current, now);
  setUpLike(root.querySelector('#like'));
  playHero(root.querySelector('.hero-video'));
}

function drawWeekly(canvas, weeks, current, now) {
  const muted = css('--muted'), border = css('--border'), lime = css('--lime');
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: weeks.map((x) => x.week),
      datasets: [
        { label: 'Planned', data: weeks.map((x) => +x.planned.toFixed(1)), backgroundColor: css('--planned'), borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, barPercentage: 0.9 },
        { label: 'Actual', data: weeks.map((x) => (x.start <= now ? +x.actual.toFixed(1) : null)), backgroundColor: lime, borderRadius: 4, borderSkipped: 'bottom', categoryPercentage: 0.72, barPercentage: 0.9 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1E2127', borderColor: border, borderWidth: 1, titleColor: '#F2F3F5', bodyColor: '#F2F3F5', padding: 10,
          callbacks: {
            title: (i) => { const x = weeks[i[0].dataIndex]; return `Week ${x.week} · ${fmtDate(x.start)} – ${fmtDate(addDays(x.end, -1))}`; },
            label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '–' : c.raw.toFixed(1) + ' km'}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: border }, ticks: { maxRotation: 0, autoSkipPadding: 6, color: (c) => (c.index + 1 === current ? lime : muted), font: (c) => ({ weight: c.index + 1 === current ? 700 : 400 }) }, title: { display: true, text: 'Plan week', color: muted } },
        y: { beginAtZero: true, grid: { color: border }, border: { display: false }, ticks: { color: muted, callback: (v) => `${v} km` } },
      },
    },
  });
}

async function setUpLike(btn) {
  const count = btn.querySelector('.like-count');
  const show = (n, liked) => {
    count.textContent = n ?? '';
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', String(liked));
    btn.querySelector('.like-label').textContent = liked ? 'Liked' : 'Like';
    btn.title = liked ? 'Thanks for the support' : 'Send some support';
  };
  let n = null;
  try { n = await likeCount(); } catch { /* count unavailable: button still works */ }
  show(n, hasLiked());
  btn.addEventListener('click', async () => {
    if (hasLiked()) return;
    show(n == null ? null : n + 1, true);
    try { await addLike(); n = (n ?? 0) + 1; }
    catch { show(n, false); }
  });
}

/** Autoplay the banner video (muted, so browsers allow it), unless the viewer prefers reduced motion. */
function playHero(video) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Full HD on larger screens, a lighter copy on phones.
  video.src = matchMedia('(min-width: 761px)').matches ? 'assets/hero-1080.mp4' : 'assets/hero-720.mp4';
  video.play().catch(() => { /* autoplay blocked: the poster image shows instead */ });
}

const hms = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : `${m}m ${String(x).padStart(2, '0')}s`; };
const pace = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Latest run, Strava-style. */
function latestRunHtml(run) {
  if (!run) return '<div class="sub">No runs yet.</div>';
  const stats = [
    ['Distance', `${km1(run.km)} km`],
    run.moving_time_s && ['Time', hms(run.moving_time_s)],
    run.avg_pace_s_per_km && ['Pace', `${pace(run.avg_pace_s_per_km)} /km`],
    run.elevation_m != null && ['Elevation', `${Math.round(run.elevation_m)} m`],
  ].filter(Boolean);
  return `
    <a class="latest" href="#run/${run.id}">
      <div class="latest-title">${run.title ?? 'Run'} <span class="muted small">· details →</span></div>
      <div class="sub">Latest run · ${fmtDate(run.date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      <div class="latest-stats">${stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    </a>`;
}
