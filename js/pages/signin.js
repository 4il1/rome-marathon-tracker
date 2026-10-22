import { sendSignInLink, isOwner, signOut, linkError } from '../auth.js';
import { CONFIG } from '../config.js';

// Cloudflare's always-pass test key locally: the real key only works on the live hostname.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const SITE_KEY = LOCAL ? '1x00000000000000000000AA' : CONFIG.turnstileSiteKey;

let turnstileReady;
function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => { turnstileReady = undefined; reject(new Error('The bot check could not load.')); };
    document.head.append(s);
  });
  return turnstileReady;
}

export async function renderSignIn(root) {
  if (await isOwner()) {
    root.innerHTML = `
      <h1>Signed in</h1>
      <p class="lede">You can upload runs on the Runs page.</p>
      <div class="links"><a class="btn primary" href="#runs">Go to Runs</a><button class="btn" id="out" type="button">Sign out</button></div>`;
    root.querySelector('#out').addEventListener('click', async () => { await signOut(); location.hash = '#home'; });
    return;
  }

  const failed = await linkError();
  root.innerHTML = `
    <h1>Owner sign-in</h1>
    <p class="lede">Only the site owner can upload runs. Everyone else can view the site without signing in.</p>
    ${failed ? '<p class="field-error link-error" role="alert"></p>' : ''}
    <form class="panel signin" novalidate>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" placeholder="name@example.com" required>
      <div class="captcha" id="captcha"></div>
      <p class="field-error" id="err" hidden></p>
      <button class="btn primary" type="submit">Email me a sign-in link</button>
      <p class="muted small">Open the link on this device and in this browser.</p>
    </form>`;

  if (failed) root.querySelector('.link-error').textContent = failed;
  const form = root.querySelector('form');
  const email = root.querySelector('#email');
  const err = root.querySelector('#err');
  email.addEventListener('input', () => { err.hidden = true; });

  // Supabase rejects sign-in requests without a Turnstile token. Each token works once.
  let token = null;
  let widget;
  const WAITING = 'Wait for the bot check to finish (or tick the box), then try again.';
  const showErr = (text) => { err.textContent = text; err.hidden = false; };
  loadTurnstile().then((ts) => {
    widget = ts.render(root.querySelector('#captcha'), {
      sitekey: SITE_KEY,
      theme: 'dark',
      callback: (t) => { token = t; if (err.textContent === WAITING) err.hidden = true; },
      'expired-callback': () => { token = null; },
      'error-callback': () => { token = null; showErr('The bot check failed. Reload the page and try again.'); },
    });
  }).catch((ex) => showErr(`${ex.message} Check your connection and reload the page.`));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.checkValidity()) { showErr('Enter a valid email address.'); return; }
    if (!token) { showErr(WAITING); return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await sendSignInLink(email.value.trim(), token);
      form.innerHTML = '<h2>Check your email</h2><p class="muted">Open the sign-in link on this device. It brings you back to the Runs page.</p>';
    } catch (ex) {
      err.textContent = /signups not allowed|not found/i.test(ex.message) ? 'That email isn\'t the owner account.'
        : /email rate limit exceeded/i.test(ex.message) ? 'The free email limit (2 sign-in emails an hour) is used up. Use your newest email link, or try again later.'
        : /request this after|rate limit/i.test(ex.message) ? 'A link was sent in the last minute. Check your inbox (and spam), or try again in a minute.'
        : /captcha/i.test(ex.message) ? 'The bot check didn\'t pass. Wait for it to finish again, then retry.'
        : `Couldn't send the link. ${ex.message}`;
      err.hidden = false;
      token = null;
      if (widget !== undefined) window.turnstile.reset(widget);
      btn.disabled = false;
      btn.textContent = 'Email me a sign-in link';
    }
  });
}
