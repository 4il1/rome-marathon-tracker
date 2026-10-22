import { supabase } from './data.js';

// Only the owner has an account. Writes are blocked in the database unless the user is in app_owner.
// Owner account created 2026-10-22; new sign-ups through the site are off.
const ALLOW_NEW_USERS = false;

let owner = null;

// A failed email link comes back as ?error=… or #error=…, which the router would treat as a page name.
// Read it before anything else touches the URL.
const urlError = (() => {
  const params = new URLSearchParams(location.search + '&' + location.hash.slice(1));
  if (!params.get('error') && !params.get('error_description')) return null;
  history.replaceState(history.state, '', location.pathname + '#signin');
  return params.get('error_code') || params.get('error_description') || params.get('error');
})();
const hadCode = new URLSearchParams(location.search).has('code');

/** Why the email link just opened didn't sign in, or null. */
export async function linkError() {
  if (urlError) {
    return /otp_expired|invalid or has expired/i.test(urlError)
      ? 'That sign-in link has expired or was already used. Each link works once: send a new one below.'
      : `That sign-in link didn't work (${urlError.replace(/_/g, ' ')}). Send a new one below.`;
  }
  if (!hadCode) return null;
  const { error } = await supabase.auth.initialize();
  if (error) return `Sign-in didn't finish: ${error.message}. Send a new link below.`;
  // supabase-js silently ignores a code this browser didn't ask for, so check a session was made.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return null;
  return 'The link opened in a different browser from the one you asked for it in. Send a new link, then open it in this same browser (if your email app opens links in its own browser, copy the link and paste it into this one).';
}

export async function isOwner() {
  if (owner !== null) return owner;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return (owner = false);
  const { data, error } = await supabase.rpc('is_owner');
  return (owner = !error && data === true);
}

export async function sendSignInLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: ALLOW_NEW_USERS, emailRedirectTo: location.origin + location.pathname + '#runs' },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
  owner = false;
}

supabase.auth.onAuthStateChange(() => { owner = null; });
