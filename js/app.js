import { renderHome } from './pages/home.js';
import { renderPlan } from './pages/plan.js';
import { renderRuns } from './pages/runs.js';
import { renderProgress } from './pages/progress.js';
import { ensureHuman } from './gate.js';

const PAGES = { home: renderHome, plan: renderPlan, runs: renderRuns, progress: renderProgress };
const root = document.getElementById('page');

async function route() {
  await ensureHuman(root);
  const name = (location.hash.slice(1) || 'home').split('/')[0];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  const render = PAGES[name];
  root.innerHTML = '';
  if (render) await render(root);
  else root.innerHTML = '<div class="empty">This page is coming next.</div>';
  root.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
route();
