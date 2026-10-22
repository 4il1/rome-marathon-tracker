// Target paces (min/km) for the 3:50:00 goal: one third of the way from the B.A.A. 3:45 to 4:00 columns.
// Marathon pace uses the exact goal pace (3:50:00 ÷ 42.195 km).
export const PACES = {
  '5K': '4:43',
  '10K': '4:58',
  HMP: '5:14',
  MP: '5:27',
  aerobic: '5:54',
  easy: '6:15',
};

/** Add the target pace after each effort named in a session description. */
export function withPaces(text) {
  return text
    .replace(/at 10K pace/g, `at 10K pace (${PACES['10K']})`)
    .replace(/at 5K pace/g, `at 5K pace (${PACES['5K']})`)
    .replace(/at HMP/g, `at HMP (${PACES.HMP})`)
    .replace(/at MP\b/g, `at MP (${PACES.MP})`)
    .replace(/MP tempo/g, `MP tempo (${PACES.MP})`);
}

/** Pace for a whole session, where the session is run at one effort. */
export function sessionPace(type, title) {
  if (type === 'easy' || (type === 'long' && /easy/.test(title))) return PACES.easy;
  if (type === 'aer') return PACES.aerobic;
  if (type === 'race') return PACES.MP;
  return null;
}
