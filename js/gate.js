import { supabase } from './data.js';
import { CONFIG } from './config.js';

// Visitors prove they are human once per browser: a Cloudflare Turnstile check creates an anonymous
// Supabase session (CAPTCHA protection is on in Supabase Auth), and the database only serves data
// to sessions. The session is kept in the browser, so returning visitors go straight in.

// Turnstile only issues real tokens on the live hostname, so the local preview skips the check.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

let turnstileReady;
function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => { turnstileReady = undefined; reject(new Error('The human check could not load.')); };
    document.head.append(s);
  });
  return turnstileReady;
}

/** Resolves once this browser has a session, showing the human check in root if needed. */
export async function ensureHuman(root) {
  if (LOCAL) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return;

  document.body.classList.add('gated');
  root.innerHTML = `
    <section class="gate">
      <p class="gate-site"><span class="dot"></span>Rome Marathon Build</p>
      <h1>Confirm you are human</h1>
      <p class="lede">A quick check from Cloudflare keeps bots out. You only do this once on this device.</p>
      <div class="captcha" id="captcha"></div>
      <p class="field-error" id="gate-err" role="alert" hidden></p>
    </section>`;
  const err = root.querySelector('#gate-err');
  const showErr = (text) => { err.textContent = text; err.hidden = false; };

  try {
    const ts = await loadTurnstile();
    await new Promise((resolve) => {
      const widget = ts.render(root.querySelector('#captcha'), {
        sitekey: CONFIG.turnstileSiteKey,
        theme: 'dark',
        callback: async (token) => {
          err.hidden = true;
          const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
          if (!error) return resolve();
          showErr(`Couldn't open the site: ${error.message}. Try again.`);
          ts.reset(widget);
        },
        'error-callback': () => showErr('The human check failed. Reload the page and try again.'),
      });
    });
  } catch (e) {
    showErr(`${e.message} Check your connection and reload the page.`);
    await new Promise(() => {}); // stay on the check
  }
  document.body.classList.remove('gated');
}
