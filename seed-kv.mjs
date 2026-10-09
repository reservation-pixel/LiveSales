// One-off: push the local disk cache into Upstash, so the deployment starts
// with six months already answered.
//
//   node --env-file=.env seed-kv.mjs          # dry run, reports what it would do
//   node --env-file=.env seed-kv.mjs --write  # actually writes
//
// Why seed rather than let the deployment fill itself: Vercel has no disk and
// cannot poll — a container freezes the moment it responds. Left alone it warms
// only what someone happens to open, and pays ~20s and 90 upstream calls for
// each cold month. This machine already holds every one of those days, so the
// whole history can be handed over without touching Petpooja at all.

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_VERSION } from './categories.mjs';
import { kvAvailable, kvConfig, kvGetMany, kvSetMany } from './kv.mjs';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
// Must match store-kv.mjs exactly, or the deployment reads a different keyspace
// and the seed is invisible to it.
const key = (outletId, date) => `v${MAP_VERSION}:${outletId}:${date}`;

const write = process.argv.includes('--write');

if (!kvAvailable()) {
  console.error(
    'No KV configured. Add the Upstash REST URL and token to .env as\n' +
    '  KV_REST_API_URL=…\n  KV_REST_API_TOKEN=…\n' +
    '(UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are accepted too.)',
  );
  process.exit(1);
}

const entries = [];
let stale = 0;
let unreadable = 0;

for (const outletId of (await readdir(DATA_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)) {
  for (const file of await readdir(join(DATA_DIR, outletId))) {
    if (!file.endsWith('.json')) continue;
    const date = file.slice(0, -5);
    const path = join(DATA_DIR, outletId, file);
    try {
      const day = JSON.parse(await readFile(path, 'utf8'));
      // Written under a different category map: its group split is not what
      // this build computes, so seeding it would publish figures the code
      // disagrees with. Let the deployment fetch those days itself.
      if (day.mapVersion !== MAP_VERSION) {
        stale += 1;
        continue;
      }
      const { mapVersion, ...rest } = day;
      // The disk format carries no fetch time; the deployment's does, and uses
      // it both to decide when today has gone stale and to report the outlet as
      // reporting rather than waiting. The file's mtime is the honest answer.
      const fetchedAt = day.fetchedAt ?? (await stat(path)).mtimeMs;
      entries.push([key(outletId, date), { ...rest, fetchedAt }]);
    } catch {
      unreadable += 1;
    }
  }
}

entries.sort(([a], [b]) => (a < b ? -1 : 1));
const dates = entries.map(([k]) => k.split(':')[2]).sort();
const bytes = entries.reduce((n, [, v]) => n + JSON.stringify(v).length, 0);

console.log(`store:      ${new URL(kvConfig().url).host}`);
console.log(`map:        v${MAP_VERSION}`);
console.log(`records:    ${entries.length}  (${dates[0]} .. ${dates.at(-1)})`);
console.log(`payload:    ${(bytes / 1e6).toFixed(1)} MB`);
if (stale) console.log(`skipped:    ${stale} written under an older category map`);
if (unreadable) console.log(`skipped:    ${unreadable} unreadable`);

if (!write) {
  console.log('\nDry run. Re-run with --write to seed.');
  process.exit(0);
}

const started = Date.now();
await kvSetMany(entries);
console.log(`\nwrote ${entries.length} records in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// Read a sample back through the same path the deployment uses. A seed that
// wrote to a keyspace the app does not read is the failure worth catching, and
// it is silent otherwise.
const sample = [entries[0][0], entries[Math.floor(entries.length / 2)][0], entries.at(-1)[0]];
const back = await kvGetMany(sample);
for (const k of sample) {
  const v = back.get(k);
  console.log(`  ${v ? '✓' : '✗'} ${k}  ${v ? `₹${Math.round(v.totalSales).toLocaleString('en-IN')}` : 'MISSING'}`);
}
if (sample.some((k) => !back.get(k))) process.exit(1);
