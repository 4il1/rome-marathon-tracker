import { renderHome } from './pages/home.js';
import { renderPlan } from './pages/plan.js';
import { renderRuns } from './pages/runs.js';
import { renderAnalysis } from './pages/analysis.js';
import { renderRun } from './pages/run.js';
import { ensureHuman } from './gate.js';

const PAGES = { home: renderHome, plan: renderPlan, runs: renderRuns, analysis: renderAnalysis, run: renderRun };
// Pages without their own menu item highlight their parent.
const PARENT = { run: 'runs' };
const root = document.getElementById('page');

async function route() {
  await ensureHuman(root);
  let [name, arg] = (location.hash.slice(1) || 'home').split('/');
  if (name === 'progress') { name = 'analysis'; history.replaceState(history.state, '', '#analysis'); } // old link
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === (PARENT[name] ?? name)));
  const render = PAGES[name];
  root.innerHTML = '';
  if (render) await render(root, arg);
  else root.innerHTML = '<div class="empty">This page is coming next.</div>';
  root.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
