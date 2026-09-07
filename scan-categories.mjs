// Check the category map against every day on disk.
//
//   node scan-categories.mjs
//
// verify.mjs checks one day live. This checks all of the cached history, which
// is where renamed categories turn up — a menu re-cut at one outlet in July is
// invisible in today's payload but sits in three months of totals.

import { readdir, readFile } from 'node:fs/promises';
import { classify, groupOf, MAP_VERSION } from './categories.mjs';

const totals = {};
const unmapped = {};
const byKeyword = {};
let files = 0;

let outletDirs;
try {
  outletDirs = await readdir('data');
} catch {
  console.error('No data/ directory yet — start the server once to backfill.');
  process.exit(1);
}

for (const outlet of outletDirs) {
  for (const file of await readdir(`data/${outlet}`)) {
    const day = JSON.parse(await readFile(`data/${outlet}/${file}`, 'utf8'));
    files += 1;
    for (const [name, sales] of Object.entries(day.categories || {})) {
      totals[name] = (totals[name] || 0) + sales;
      const { by } = classify(name);
      if (by === null) unmapped[name] = (unmapped[name] || 0) + sales;
      if (by === 'keyword') byKeyword[name] = (byKeyword[name] || 0) + sales;
    }
  }
}

const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const names = Object.keys(totals);
const byGroup = {};
for (const n of names) (byGroup[groupOf(n)] ??= []).push(n);

console.log(`\n${names.length} category names across ${files} outlet-days (map ${MAP_VERSION})\n`);
for (const group of ['desserts', 'drinks', 'other']) {
  const list = (byGroup[group] || []).sort((a, b) => totals[b] - totals[a]);
  const sum = list.reduce((s, n) => s + totals[n], 0);
  console.log(`${group.padEnd(9)} ${String(list.length).padStart(3)} categories  ${money(sum).padStart(15)}`);
  if (group !== 'other') for (const n of list) console.log(`     ${n.padEnd(34)} ${money(totals[n])}`);
}

if (Object.keys(byKeyword).length) {
  console.log('\nMatched on a keyword rather than by name — promote to categories.mjs to make the call explicit:');
  for (const [n, v] of Object.entries(byKeyword).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${n.padEnd(34)} ${groupOf(n).padEnd(9)} ${money(v)}`);
  }
}

if (!Object.keys(unmapped).length) {
  console.log('\nEvery category is classified.\n');
  process.exit(0);
}

console.log(`\n${Object.keys(unmapped).length} unrecognised — counted in Other, add to categories.mjs if any belong in a group:`);
for (const [n, v] of Object.entries(unmapped).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${n.padEnd(34)} ${money(v)}`);
}
console.log('');
