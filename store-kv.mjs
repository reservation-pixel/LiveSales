// The store, for a place that freezes your process.
//
// store.mjs assumes a process that stays alive: a 60s poll loop and a disk
// cache. Neither survives on Vercel, which suspends the container the moment a
// response is sent — that is why the deployed dashboard recorded fetches taking
// 244 seconds against a 30-second timeout. The work had been suspended
// mid-flight and only resumed when the container was next woken.
//
// So everything here happens *inside* the request, before the response is
// returned, and the cache lives in KV rather than on a disk that does not exist.
//
// Two properties make that affordable:
//   - a closed day never changes, so it is fetched once, ever
//   - one upstream call returns two days, halving the cost of a cold range

import { ACTIVE } from './outlets.mjs';
import { fetchOrders } from './petpooja.mjs';
import { aggregateDay, emptyDay } from './aggregate.mjs';
import { MAP_VERSION } from './categories.mjs';
import { addDays, today } from './periods.mjs';
import { kvGetMany, kvSetMany } from './kv.mjs';

// Namespaced by the category map, so editing the map invalidates every cached
// aggregate instead of silently serving figures grouped by the old one.
const key = (outletId, date) => `v${MAP_VERSION}:${outletId}:${date}`;

// Today is still moving, so a cached copy of it is only trusted briefly.
const TODAY_TTL_MS = 60_000;

// How long this request may spend fetching before it gives up and returns what
// it has. The page already knows how to show a partial period — `complete:
// false` — and will ask again, so an incomplete answer beats a timeout.
const DEFAULT_BUDGET_MS = 20_000;

// Petpooja tolerated 12 rapid calls in testing, so a little parallelism is
// safe and is the difference between a cold month loading and timing out.
const CONCURRENCY = 4;

const runPool = async (jobs, limit) => {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await job();
    }
  });
  await Promise.all(workers);
};

export class KvStore {
  constructor({ creds, budgetMs = DEFAULT_BUDGET_MS }) {
    this.creds = creds;
    this.budgetMs = budgetMs;
    this.days = new Map();
    this.health = new Map(
      ACTIVE.map((o) => [o.id, { lastSuccessAt: null, lastError: null, lastMs: null }]),
    );
    this.backfill = { running: false, done: 0, total: 0 };
    this.ready = false;
    this.fetched = 0;
    this.truncated = false;
  }

  get(outletId, date) {
    return this.days.get(`${outletId}:${date}`) ?? null;
  }

  range(outletId, dates) {
    return dates.map((d) => this.get(outletId, d) ?? emptyDay(outletId, d));
  }

  covers(dates) {
    return ACTIVE.every((o) => dates.every((d) => this.days.has(`${o.id}:${d}`)));
  }

  span() {
    let from = today();
    for (const k of this.days.keys()) {
      const date = k.slice(k.indexOf(':') + 1);
      if (date < from) from = date;
    }
    return { from, to: today() };
  }

  /**
   * Fill `dates` for every active outlet: KV first, then upstream for whatever
   * is missing, within the time budget.
   */
  async load(dates) {
    const started = Date.now();
    const wanted = [...new Set(dates)].sort();

    // ---- 1. one pipelined read for everything ----
    const keys = [];
    for (const o of ACTIVE) for (const d of wanted) keys.push(key(o.id, d));

    let cached = new Map();
    try {
      cached = await kvGetMany(keys);
    } catch (err) {
      // A KV outage must not take the dashboard down; it degrades to fetching.
      this.kvError = err.message;
    }
    for (const o of ACTIVE) {
      for (const d of wanted) {
        const hit = cached.get(key(o.id, d));
        if (hit) this.days.set(`${o.id}:${d}`, hit);
      }
    }
    this.ready = true;

    // ---- 2. work out what still has to come from upstream ----
    const now = today();
    const jobs = [];
    for (const outlet of ACTIVE) {
      const missing = wanted.filter((d) => {
        const have = this.days.get(`${outlet.id}:${d}`);
        if (!have) return true;
        // Today is refetched once its cached copy goes stale; closed days never.
        return d === now && Date.now() - (have.fetchedAt ?? 0) > TODAY_TTL_MS;
      });

      // A call for D also returns D-1, so walking back in twos halves the work.
      const targets = [];
      for (let i = missing.length - 1; i >= 0; i -= 1) {
        const d = missing[i];
        if (targets.some((t) => t === d || addDays(t, -1) === d)) continue;
        targets.push(d);
      }
      for (const d of targets) jobs.push([outlet, d]);
    }

    if (!jobs.length) return;
    this.backfill = { running: true, done: 0, total: jobs.length };

    // ---- 3. fetch, writing through to KV ----
    const toWrite = [];
    const tasks = jobs.map(([outlet, date]) => async () => {
      if (Date.now() - started > this.budgetMs) {
        this.truncated = true;
        return;
      }
      const res = await fetchOrders(this.creds, outlet.restID, date);
      const h = this.health.get(outlet.id);
      h.lastMs = res.ms;
      if (!res.ok) {
        h.lastError = res.error;
        this.backfill.done += 1;
        return;
      }
      h.lastError = null;
      h.lastSuccessAt = Date.now();
      this.fetched += 1;

      for (const d of [date, addDays(date, -1)]) {
        if (d > now) continue;
        const day = { ...aggregateDay(outlet.id, d, res.orders), fetchedAt: Date.now() };
        this.days.set(`${outlet.id}:${d}`, day);
        // Only days that are settled, or today, are worth persisting; a day
        // outside the asked-for window is a free byproduct and cached anyway.
        toWrite.push([key(outlet.id, d), day]);
      }
      this.backfill.done += 1;
    });

    await runPool(tasks, CONCURRENCY);
    this.backfill.running = false;

    if (toWrite.length) {
      try {
        await kvSetMany(toWrite);
      } catch (err) {
        // Failing to cache is survivable — the figures are already computed and
        // will simply be refetched next time.
        this.kvError = err.message;
      }
    }
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
