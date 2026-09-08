// State: day aggregates in memory, closed days on disk, one poll loop.
//
// The unit of storage is the outlet-day. Everything the dashboard asks for is a
// sum over a slice of it, so period switching costs no API calls.
//
// Two properties of the upstream API shape this:
//   - a call for date D returns D and D-1, so backfilling N days costs N/2 calls
//     and every poll refreshes yesterday for free. That last part matters:
//     late-night orders land against the previous business day after midnight.
//   - history is real. A call for a date three weeks back returns that day's
//     orders, so weekly and monthly views are not built by accumulating forward.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE, BY_ID } from './outlets.mjs';
import { fetchOrders } from './petpooja.mjs';
import { aggregateDay, emptyDay } from './aggregate.mjs';
import { MAP_VERSION } from './categories.mjs';
import { addDays, datesInRange, today } from './periods.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');

const STAGGER_MS = 400; // Petpooja's own docs suggest this between calls.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const key = (outletId, date) => `${outletId}:${date}`;
const fileFor = (outletId, date) => join(DATA_DIR, outletId, `${date}.json`);

export class Store {
  constructor({ creds, pollMs = 60_000, backfillMonths = 2, log = console.log }) {
    this.creds = creds;
    this.pollMs = pollMs;
    this.backfillMonths = backfillMonths;
    this.log = log;
    /** @type {Map<string, object>} outletId:date → day aggregate */
    this.days = new Map();
    /** @type {Map<string, {lastSuccessAt: number|null, lastError: string|null, lastMs: number|null}>} */
    this.health = new Map(ACTIVE.map((o) => [o.id, { lastSuccessAt: null, lastError: null, lastMs: null }]));
    this.backfill = { running: false, done: 0, total: 0 };
    this.inFlight = new Set();
    this.timer = null;
  }

  get(outletId, date) {
    return this.days.get(key(outletId, date)) ?? null;
  }

  /** Days for a range, with absent days as zeroes so a period is never short. */
  range(outletId, dates) {
    return dates.map((d) => this.get(outletId, d) ?? emptyDay(outletId, d));
  }

  /** True when every date asked for is present — drives the "still loading" flag. */
  covers(dates) {
    return ACTIVE.every((o) => dates.every((d) => this.days.has(key(o.id, d))));
  }

  /**
   * The span of dates that have been fetched, so the calendar can dim what
   * cannot be picked. An undimmed date with nothing behind it renders an empty
   * dashboard, which reads as a collapse in trade rather than a gap in loading.
   * `to` is always today: it has data by definition, even before the first
   * order of the day lands.
   */
  span() {
    let from = today();
    for (const k of this.days.keys()) {
      const date = k.slice(k.indexOf(':') + 1);
      if (date < from) from = date;
    }
    return { from, to: today() };
  }

  // ---- persistence ---------------------------------------------------
  // Only closed days are written. Today is still moving, so caching it would
  // serve a stale figure to the next process to start.

  async persist(day) {
    if (day.date >= today()) return;
    const path = fileFor(day.outletId, day.date);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...day, mapVersion: MAP_VERSION }));
  }

  async loadFromDisk() {
    let loaded = 0;
    let stale = 0;
    const from = addDays(today(), -(this.backfillMonths + 1) * 31);
    for (const outlet of ACTIVE) {
      for (const date of datesInRange(from, today())) {
        if (this.days.has(key(outlet.id, date))) continue;
        try {
          const day = JSON.parse(await readFile(fileFor(outlet.id, date), 'utf8'));
          // Written under a different category map: the group split in it is
          // not what this build would compute. Leave it out and let the
          // backfill replace it.
          if (day.mapVersion !== MAP_VERSION) {
            stale += 1;
            continue;
          }
          this.days.set(key(outlet.id, date), day);
          loaded += 1;
        } catch {
          // Absent is the normal case, not an error.
        }
      }
    }
    this.log(
      `  cache        →  ${loaded} outlet-days from disk` +
        (stale ? `, ${stale} stale (category map changed — refetching)` : ''),
    );
    return loaded;
  }

  // ---- fetching ------------------------------------------------------

  /**
   * One call, two days recorded. Returns false if the call failed, so callers
   * can decide whether to keep going; it never throws.
   */
  async fetchDate(outlet, date) {
    const guard = key(outlet.id, date);
    if (this.inFlight.has(guard)) return true;
    this.inFlight.add(guard);
    try {
      const res = await fetchOrders(this.creds, outlet.restID, date);
      const health = this.health.get(outlet.id);
      health.lastMs = res.ms;

      if (!res.ok) {
        health.lastError = res.error;
        return false;
      }
      health.lastError = null;
      health.lastSuccessAt = Date.now();

      // Record both days the payload covers. Recording only the requested one
      // would throw away half of every call and double the backfill.
      for (const d of [date, addDays(date, -1)]) {
        const day = aggregateDay(outlet.id, d, res.orders);
        this.days.set(key(outlet.id, d), day);
        await this.persist(day);
      }
      return true;
    } finally {
      this.inFlight.delete(guard);
    }
  }

  /** Fill any missing day in `dates`, cheapest first: each call covers two. */
  async ensure(dates) {
    const wanted = [...dates].sort();
    const jobs = [];
    for (const outlet of ACTIVE) {
      const missing = wanted.filter((d) => !this.days.has(key(outlet.id, d)));
      // Walk backwards taking every second date: a call for D also yields D-1.
      const targets = [];
      for (let i = missing.length - 1; i >= 0; i -= 1) {
        const d = missing[i];
        if (targets.some((t) => t === d || addDays(t, -1) === d)) continue;
        targets.push(d);
      }
      for (const d of targets) jobs.push([outlet, d]);
    }
    if (!jobs.length) return 0;

    this.backfill = { running: true, done: 0, total: jobs.length };
    for (const [outlet, date] of jobs) {
      await this.fetchDate(outlet, date);
      this.backfill.done += 1;
      await sleep(STAGGER_MS);
    }
    this.backfill.running = false;
    return jobs.length;
  }

  /** Today for every outlet — one call each, which also refreshes yesterday. */
  async pollToday() {
    const date = today();
    for (const outlet of ACTIVE) {
      await this.fetchDate(outlet, date);
      await sleep(STAGGER_MS);
    }
  }

  // ---- lifecycle -----------------------------------------------------

  /**
   * Serve from disk immediately, then fill history in the background. Blocking
   * the page on an 80-second cold backfill would make the first run look broken.
   */
  async start() {
    await this.loadFromDisk();
    await this.pollToday();

    const from = `${addMonths(today(), -this.backfillMonths).slice(0, 7)}-01`;
    const dates = datesInRange(from, today());
    this.ensure(dates)
      .then((n) => n && this.log(`  backfill     →  ${n} calls, ${dates.length} days covered`))
      .catch((err) => this.log(`  backfill failed: ${err.message}`));

    this.timer = setInterval(() => {
      this.pollToday().catch((err) => this.log(`poll failed: ${err.message}`));
    }, this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  healthReport() {
    return ACTIVE.map((o) => ({
      id: o.id,
      name: o.name,
      brand: o.brand,
      ...this.health.get(o.id),
    }));
  }
}

const addMonths = (dateKey, n) => {
  const [y, m] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

export { BY_ID };
