import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from './config.js';
import { parseDay } from './util.js';

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let cache;

/** All runs, newest first, with a local `date` and `km` added. */
export async function loadRuns() {
  if (cache) return cache;
  const rows = [];
  // Supabase returns at most 1000 rows per request, so page through.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('runs').select('*').order('start_time', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  cache = rows.map((r) => ({ ...r, distance_km: Number(r.distance_km), date: parseDay(r.start_time), km: Number(r.distance_km) }));
  return cache;
}

export function clearRunsCache() { cache = undefined; }

const LIKED_KEY = 'rmb-liked';

export async function likeCount() {
  const { count, error } = await supabase.from('likes').select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

/** One like per browser, remembered locally. */
export function hasLiked() {
  try { return localStorage.getItem(LIKED_KEY) === '1'; } catch { return false; }
}

export async function addLike() {
  const { error } = await supabase.from('likes').insert({});
  if (error) throw error;
  try { localStorage.setItem(LIKED_KEY, '1'); } catch { /* private mode: like still counts */ }
}
