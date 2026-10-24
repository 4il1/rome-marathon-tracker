// Garmin Connect Personal API client: token, activity list, activity file, wellness.
const GARMIN = 'https://personal.connectapi.garmin.com';
const PAGE = 99;

// deno-lint-ignore no-explicit-any
export type Json = Record<string, any>;

export async function garminToken(apiKey: string): Promise<string> {
  const res = await fetch(`${GARMIN}/personalapitoken-service/personal-api/personal-api-key/token`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Garmin token request failed (${res.status}): ${text.slice(0, 300)}`);
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* plain-text token */ }
  const token = body.access_token ?? body.accessToken ?? body.token ?? (text && !text.startsWith('{') ? text.trim() : null);
  if (typeof token !== 'string') throw new Error(`No token in Garmin response (fields: ${Object.keys(body).join(', ')})`);
  return token;
}

export class Garmin {
  constructor(private token: string) {}

  async raw(path: string, params: Record<string, string> = {}): Promise<Response> {
    const q = new URLSearchParams(params);
    const res = await fetch(`${GARMIN}${path}${q.size ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Garmin ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async get(path: string, params: Record<string, string> = {}) {
    return (await this.raw(path, params)).json();
  }

  /** Running activities (all running subtypes), newest first. */
  async runs(startDate?: string): Promise<Json[]> {
    const all: Json[] = [];
    for (let start = 0; ; start += PAGE) {
      const params: Record<string, string> = { start: String(start), limit: String(PAGE), activityType: 'running' };
      if (startDate) params.startDate = startDate;
      const page: Json[] = await this.get('/activitylist-service/activities/search/activities', params);
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  }

  /** The activity's original file (a zip holding the .fit). */
  async activityFile(activityId: number): Promise<Uint8Array> {
    return new Uint8Array(await (await this.raw(`/download-service/files/activity/${activityId}`)).arrayBuffer());
  }
}
