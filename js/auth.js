import { supabase } from './data.js';

// Only the owner has an account. Writes are blocked in the database unless the user is in app_owner.
// Owner account created 2026-10-22; new sign-ups through the site are off.
const ALLOW_NEW_USERS = false;

let owner = null;

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
