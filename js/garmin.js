// Parse a Garmin Connect "Activities" CSV export into run records (km and seconds).
const RUN_TYPES = new Set(['Running', 'Treadmill Running']);
const MISSING = new Set(['', '--', '--:--:--', '00:NaN:NaN']);

const num = (v) => (MISSING.has(v ?? '') ? null : Number(String(v).replace(/,/g, '')));
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
function secs(v) {
  if (MISSING.has(v ?? '')) return null;
  const p = String(v).split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return Math.round(p.reduce((t, x) => t * 60 + x, 0)); // exports can include tenths of a second
}

export function parseGarminCsv(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  return data
    .filter((r) => RUN_TYPES.has(r['Activity Type']))
    .map((r) => {
      const km = num(r['Distance']);
      const time = secs(r['Moving Time']) ?? secs(r['Time']);
      return {
        start_time: r['Date'].replace(' ', 'T'),
        title: r['Title'],
        type: r['Activity Type'],
        distance_km: km,
        moving_time_s: time,
        avg_pace_s_per_km: km && time ? Math.round(time / km) : null,
        avg_hr: int(r['Avg HR']),
        max_hr: int(r['Max HR']),
        elevation_m: num(r['Total Ascent']),
      };
    })
    .filter((r) => r.distance_km > 0);
}
