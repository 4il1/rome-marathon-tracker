import { sendSignInLink, isOwner, signOut } from '../auth.js';

export async function renderSignIn(root) {
  if (await isOwner()) {
    root.innerHTML = `
      <h1>Signed in</h1>
      <p class="lede">You can upload runs on the Runs page.</p>
      <div class="links"><a class="btn primary" href="#runs">Go to Runs</a><button class="btn" id="out" type="button">Sign out</button></div>`;
    root.querySelector('#out').addEventListener('click', async () => { await signOut(); location.hash = '#home'; });
    return;
  }

  root.innerHTML = `
    <h1>Owner sign-in</h1>
    <p class="lede">Only the site owner can upload runs. Everyone else can view the site without signing in.</p>
    <form class="panel signin" novalidate>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" placeholder="name@example.com" required>
      <p class="field-error" id="err" hidden></p>
      <button class="btn primary" type="submit">Email me a sign-in link</button>
      <p class="muted small">Open the link on this device and in this browser.</p>
    </form>`;

  const form = root.querySelector('form');
  const email = root.querySelector('#email');
  const err = root.querySelector('#err');
  email.addEventListener('input', () => { err.hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.checkValidity()) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await sendSignInLink(email.value.trim());
      form.innerHTML = '<h2>Check your email</h2><p class="muted">Open the sign-in link on this device. It brings you back to the Runs page.</p>';
    } catch (ex) {
      err.textContent = /signups not allowed|not found/i.test(ex.message) ? 'That email isn\'t the owner account.'
        : /email rate limit exceeded/i.test(ex.message) ? 'The free email limit (2 sign-in emails an hour) is used up. Use your newest email link, or try again later.'
        : /request this after|rate limit/i.test(ex.message) ? 'A link was sent in the last minute. Check your inbox (and spam), or try again in a minute.'
        : `Couldn't send the link. ${ex.message}`;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Email me a sign-in link';
    }
  });
}
