// Day / week / month range maths.
//
// Every figure on the dashboard is driven by one {granularity, anchor, rolling}
// triple — plus a range end for 'custom' — resolved here into a plain list of
// YYYY-MM-DD strings. Keeping it in one module is what stops "this month"
// meaning one thing in the header and another in the table.
//
// All dates are handled as YYYY-MM-DD strings and only ever converted to Date
// at UTC noon. Petpooja reports a business date, not an instant; parsing
// '2026-09-07' as UTC midnight and formatting it in IST gives back the 6th.

export const GRANULARITIES = ['day', 'week', 'month', 'custom'];

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

export const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const toUTC = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

const toKey = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

export const addDays = (key, n) => toKey(new Date(toUTC(key).getTime() + n * DAY_MS));

export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

/** Local calendar date — the business day, in the machine's timezone. */
export const today = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** The same day-of-month `n` months away, snapped to the 1st. */
export const addMonths = (dateKey, n) => {
  const [y, m] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`;
};

/**
 * What the dashboard will answer for — a declared window, not a report of what
 * happens to be cached.
 *
 * These are different questions and conflating them is what left the pickers
 * offering two days: a serverless request only ever loads its own period, so
 * "what is in memory" was the period itself. What may be *asked for* is a
 * policy decision, and both servers fetch missing days on demand anyway.
 *
 * Runs from the 1st of the month `months - 1` back, so a 6-month window always
 * contains six whole months to choose from.
 */
export const historyWindow = (months = 6, now = today()) => ({
  from: addMonths(now, -(months - 1)),
  to: now,
});

/** Inclusive list of date keys from `from` to `to`. */
export const datesInRange = (from, to) => {
  const out = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
};

// Monday-based week start. getUTCDay() is Sunday=0, so Sunday must go back six
// days rather than zero — the off-by-one that puts a Sunday's takings in the
// wrong week.
const weekStart = (key) => {
  const dow = toUTC(key).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
};

const monthStart = (key) => `${key.slice(0, 7)}-01`;
const monthEnd = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

/**
 * Resolve a period selection into two comparable ranges.
 *
 * The comparison range is truncated to the same number of days as the current
 * one. On the 7th of the month, "this month" is 7 days of trading; setting it
 * against a complete 31-day August would read as a 78% collapse that never
 * happened. So the previous month contributes the 1st-7th only, and `prev.label`
 * says so out loud rather than leaving the reader to assume.
 *
 * @param {'day'|'week'|'month'|'custom'} granularity
 * @param {string} anchor  YYYY-MM-DD, any date inside the wanted period. For
 *   'custom' it is the start of the range and `opts.to` is the end.
 * @param {{rolling?: boolean, now?: string, to?: string}} opts
 */
export const resolve = (granularity, anchor, opts = {}) => {
  const { rolling = false, now = today() } = opts;
  if (!GRANULARITIES.includes(granularity)) throw new Error(`Unknown granularity: ${granularity}`);
  if (!isDateKey(anchor)) throw new Error(`Bad anchor: ${anchor}`);

  let from;
  let to;
  if (granularity === 'custom') {
    // The range is stated outright rather than derived from an anchor, so there
    // is nothing to snap to a week or month boundary.
    if (!isDateKey(opts.to)) throw new Error(`Bad custom range end: ${opts.to}`);
    if (opts.to < anchor) throw new Error(`Custom range ends before it starts: ${anchor}…${opts.to}`);
    from = anchor;
    to = opts.to;
  } else if (granularity === 'day') {
    from = anchor;
    to = anchor;
  } else if (rolling) {
    to = anchor;
    from = addDays(anchor, granularity === 'week' ? -6 : -29);
  } else if (granularity === 'week') {
    from = weekStart(anchor);
    to = addDays(from, 6);
  } else {
    from = monthStart(anchor);
    to = monthEnd(anchor);
  }

  // A period containing today is still filling up. Cut it at today so the day
  // count used for the comparison reflects trading so far, not the calendar.
  const openEnded = daysBetween(now, to) > 0 && daysBetween(from, now) >= 0;
  const effectiveTo = openEnded ? now : to;
  const span = daysBetween(from, effectiveTo) + 1;

  // Take the whole previous period first. Deriving it as "the same number of
  // days back from the start" only works where periods are a fixed length:
  // July is 31 days and June is 30, so that rule ends July's comparison on
  // 1 July — a day of the current month, counted twice.
  let prevFrom;
  let prevTo;
  if (granularity === 'custom') {
    // Same length, immediately before, no overlap — the only defensible
    // comparison for a range the user invented.
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -daysBetween(from, to));
  } else if (granularity === 'day') {
    prevFrom = addDays(from, -1);
    prevTo = prevFrom;
  } else if (rolling) {
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -daysBetween(from, to));
  } else if (granularity === 'week') {
    prevFrom = addDays(from, -7);
    prevTo = addDays(prevFrom, 6);
  } else {
    prevFrom = monthStart(addDays(from, -1));
    prevTo = monthEnd(prevFrom);
  }

  // Only a part-traded current period truncates its comparison. A closed one
  // meets the whole of the period before it.
  if (openEnded) prevTo = addDays(prevFrom, span - 1);

  return {
    granularity,
    rolling,
    anchor,
    from,
    to: effectiveTo,
    fullTo: to,
    open: openEnded,
    includesToday: daysBetween(from, now) >= 0 && daysBetween(now, effectiveTo) >= 0,
    dates: datesInRange(from, effectiveTo),
    label: rangeLabel(from, effectiveTo, granularity),
    prev: {
      from: prevFrom,
      to: prevTo,
      dates: datesInRange(prevFrom, prevTo),
      label: rangeLabel(prevFrom, prevTo, granularity),
    },
  };
};

/**
 * Move the anchor by one whole period.
 *
 * A custom range has no calendar length to snap to, so it steps by its own
 * span — `‹` on 8–11 Sep lands on 4–7 Sep. Callers pass `span` for that case.
 */
export const step = (granularity, anchor, direction, span = 1) => {
  if (granularity === 'custom') return addDays(anchor, direction * Math.max(1, span));
  if (granularity === 'day') return addDays(anchor, direction);
  if (granularity === 'week') return addDays(weekStart(anchor), 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + direction, 1, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const rangeLabel = (from, to, granularity = 'day') => {
  const a = toUTC(from);
  const b = toUTC(to);
  const day = (dt) => dt.getUTCDate();
  const mon = (dt) => MONTHS[dt.getUTCMonth()];
  if (from === to) {
    return granularity === 'day'
      ? `${DOW[a.getUTCDay()]} ${day(a)} ${mon(a)} ${a.getUTCFullYear()}`
      : `${day(a)} ${mon(a)} ${a.getUTCFullYear()}`;
  }
  // A whole calendar month needs no day numbers.
  if (from === monthStart(from) && to === monthEnd(to) && from.slice(0, 7) === to.slice(0, 7)) {
    return `${mon(a)} ${a.getUTCFullYear()}`;
  }
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${day(a)}–${day(b)} ${mon(a)} ${a.getUTCFullYear()}`;
  }
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return sameYear
    ? `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${b.getUTCFullYear()}`
    : `${day(a)} ${mon(a)} ${a.getUTCFullYear()} – ${day(b)} ${mon(b)} ${b.getUTCFullYear()}`;
};

/**
 * Buckets for the trend line: hours within a single day, days otherwise.
 * @returns {{kind: 'hour'|'day', keys: string[]}}
 */
export const bucketsFor = (range) =>
  range.granularity === 'day'
    ? { kind: 'hour', keys: Array.from({ length: 24 }, (_, h) => pad(h)) }
    : { kind: 'day', keys: range.dates };
