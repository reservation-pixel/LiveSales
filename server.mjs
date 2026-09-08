// Live sales dashboard — static page plus a JSON API over the Petpooja feed.
//
//   node --env-file=.env server.mjs
//
// The browser never talks to Petpooja. It cannot: the API sends no CORS headers,
// and the Orders endpoint is a GET carrying a body, which fetch() refuses. This
// process makes the calls, which also keeps the credentials out of page source.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIVE, INACTIVE, BY_ID } from './outlets.mjs';
import { credentialsFromEnv } from './petpooja.mjs';
import { sumDays } from './aggregate.mjs';
import { mappingTable, groupOf, GROUP_LABELS } from './categories.mjs';
import { GRANULARITIES, daysBetween, isDateKey, resolve, today } from './periods.mjs';
import { Store } from './store.mjs';
import { summarise } from './summarise.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const POLL_MS = Number(process.env.POLL_MS || 60_000);
const BACKFILL_MONTHS = Number(process.env.BACKFILL_MONTHS || 2);

// An allowlist, not a directory listing. Serving the folder would publish .env
// — and with it the API credentials — to anything that can reach this port.
const STATIC = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
]);

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

// Reject anything not on the allowlist rather than clamping silently — a typo
// in a bookmarked URL should say so, not quietly show a different month.
// A custom range is user-invented, so every bound is checked rather than
// clamped. Silently shrinking a request the caller can see in the URL is worse
// than refusing it.
const MAX_CUSTOM_DAYS = 366;

const readPeriod = (params) => {
  const granularity = params.get('granularity') || 'day';
  if (!GRANULARITIES.includes(granularity)) {
    throw new Error(`granularity must be one of ${GRANULARITIES.join(', ')}`);
  }
  const anchor = params.get('anchor') || today();
  if (!isDateKey(anchor)) throw new Error('anchor must be YYYY-MM-DD');
  // A future anchor would trigger a backfill over days that cannot exist.
  if (anchor > today()) throw new Error('anchor cannot be in the future');

  let to;
  if (granularity === 'custom') {
    to = params.get('to');
    if (!isDateKey(to)) throw new Error('custom needs a `to` date as YYYY-MM-DD');
    if (to < anchor) throw new Error('`to` cannot be before `anchor`');
    if (to > today()) throw new Error('`to` cannot be in the future');
    // The ceiling that matters: without it a multi-year range turns one click
    // into thousands of upstream calls.
    const days = daysBetween(anchor, to) + 1;
    if (days > MAX_CUSTOM_DAYS) {
      throw new Error(`custom range is ${days} days; the maximum is ${MAX_CUSTOM_DAYS}`);
    }
  }

  return { granularity, anchor, to, rolling: params.get('rolling') === 'true' };
};


const main = async () => {
  let creds;
  try {
    creds = credentialsFromEnv();
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }

  const store = new Store({ creds, pollMs: POLL_MS, backfillMonths: BACKFILL_MONTHS });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/summary') {
      let range;
      try {
        const p = readPeriod(url.searchParams);
        range = resolve(p.granularity, p.anchor, { rolling: p.rolling, to: p.to });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
      // Navigating to an uncached month fills it in the background; the page
      // shows what it has and polls until `complete` goes true.
      //
      // The comparison range counts as much as the period itself. Checking only
      // the current one leaves a fully loaded July sitting next to a nearly
      // empty June and no fetch ever started to fix it.
      const wanted = [...range.dates, ...range.prev.dates];
      if (!store.covers(wanted) && !store.backfill.running) {
        store.ensure(wanted).catch(() => {});
      }
      return send(res, 200, summarise(store, range));
    }

    if (url.pathname.startsWith('/api/outlet/')) {
      const outlet = BY_ID.get(url.pathname.slice('/api/outlet/'.length));
      if (!outlet || !outlet.active) return send(res, 404, { error: 'Unknown outlet' });
      let range;
      try {
        const p = readPeriod(url.searchParams);
        range = resolve(p.granularity, p.anchor, { rolling: p.rolling, to: p.to });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
      const now = sumDays(store.range(outlet.id, range.dates));
      const categories = Object.entries(now.categories)
        .map(([name, sales]) => ({
          name,
          sales,
          share: now.menuSales > 0 ? Math.round((sales / now.menuSales) * 1000) / 10 : null,
          group: now.unmapped[name] != null ? 'unmapped' : groupOf(name),
        }))
        .sort((a, b) => b.sales - a.sales);
      return send(res, 200, {
        outlet: { id: outlet.id, name: outlet.name, brand: outlet.brand },
        period: { label: range.label, from: range.from, to: range.to },
        totalSales: now.totalSales,
        menuSales: now.menuSales,
        adjustments: now.adjustments,
        groups: now.groups,
        groupLabels: GROUP_LABELS,
        categories,
      });
    }

    if (url.pathname === '/api/categories') {
      return send(res, 200, { groups: mappingTable() });
    }

    if (url.pathname === '/api/health') {
      return send(res, 200, {
        ok: store.healthReport().some((h) => h.lastSuccessAt),
        pollMs: POLL_MS,
        outlets: store.healthReport(),
        backfill: store.backfill,
        cachedDays: store.days.size,
      });
    }

    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const type = STATIC.get(name);
    if (!type) return send(res, 404, { error: 'Not found' });
    try {
      const file = await readFile(join(HERE, 'public', name));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(file);
    } catch {
      send(res, 404, { error: 'Not found' });
    }
  });

  server.listen(PORT, () => {
    console.log(`\n  Live sales   →  http://localhost:${PORT}`);
    console.log(`  Outlets      →  ${ACTIVE.length} reporting, ${INACTIVE.length} without Orders API`);
    console.log(`  Poll         →  every ${POLL_MS / 1000}s`);
  });

  await store.start();
  console.log('  Ready\n');
};

main();
