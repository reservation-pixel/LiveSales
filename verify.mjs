// Assertions against live Petpooja payloads.
//
//   node --env-file=.env verify.mjs [YYYY-MM-DD]
//
// The unit tests use synthetic orders. This checks the same invariants against
// what the API actually returns, which is where the assumptions can rot.

import { ACTIVE } from './outlets.mjs';
import { credentialsFromEnv, fetchOrders } from './petpooja.mjs';
import { aggregateDay, sumDays } from './aggregate.mjs';
import { groupOf, isMapped } from './categories.mjs';
import { addDays, today } from './periods.mjs';

const date = process.argv[2] || today();
const prev = addDays(date, -1);
const creds = credentialsFromEnv();

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

console.log(`\nVerifying ${date} across ${ACTIVE.length} outlets\n`);

const unmapped = new Map();
const allDays = [];

for (const outlet of ACTIVE) {
  const res = await fetchOrders(creds, outlet.restID, date);
  if (!res.ok) {
    check(`${outlet.name}: fetch`, false, res.error);
    continue;
  }

  const day = aggregateDay(outlet.id, date, res.orders);
  const yesterday = aggregateDay(outlet.id, prev, res.orders);
  allDays.push(day);

  console.log(`${outlet.name} — ${money(day.totalSales)} over ${day.orders} orders`);

  // The mix must exhaust menu sales, or a category is being dropped.
  const groupSum = day.groups.desserts + day.groups.drinks + day.groups.other;
  check('desserts + drinks + other = menu sales', near(groupSum, day.menuSales),
    `${money(groupSum)} vs ${money(day.menuSales)}`);

  // And menu sales plus the untaggable residual must be the till figure.
  check('menu sales + adjustments = total sales',
    near(day.menuSales + day.adjustments, day.totalSales),
    `adjustments ${money(day.adjustments)} (${(day.adjustments / (day.totalSales || 1) * 100).toFixed(2)}%)`);

  // Every order in the payload belongs to one of the two days it covers.
  const dates = new Set(res.orders.map((o) => o.Order?.order_date));
  check('payload covers exactly the requested day and the one before',
    [...dates].every((d) => d === date || d === prev), [...dates].join(', ') || 'empty');

  const cancelled = res.orders.filter((o) => o.Order?.status !== 'Success' && o.Order?.order_date === date);
  if (cancelled.length) {
    const value = cancelled.reduce((s, o) => s + parseFloat(o.Order.total || 0), 0);
    check(`${cancelled.length} cancelled order(s) excluded`,
      day.totalSales < res.orders.filter((o) => o.Order?.order_date === date)
        .reduce((s, o) => s + parseFloat(o.Order.total || 0), 0),
      `worth ${money(value)}`);
  }

  check('hourly buckets reconcile with the day total',
    near(day.hours.reduce((a, b) => a + b.totalSales, 0), day.totalSales, 2));

  if (yesterday.orders) {
    console.log(`    (${prev}: ${money(yesterday.totalSales)} — refreshed by the same call)`);
  }

  for (const [name, sales] of Object.entries(day.unmapped)) {
    unmapped.set(name, (unmapped.get(name) || 0) + sales);
  }
  console.log('');
}

// Summing days must reach the same numbers as the days themselves.
const period = sumDays(allDays);
const bySum = allDays.reduce((s, d) => s + d.totalSales, 0);
check('period total equals the sum of its days', near(period.totalSales, bySum),
  `${money(period.totalSales)}`);
check('period shares are weighted, not averaged',
  period.dessertPct == null ||
    near(period.dessertPct, (period.groups.desserts / period.menuSales) * 100, 0.1),
  `desserts ${period.dessertPct}% · drinks ${period.drinkPct}%`);

console.log('\nCategory mapping');
const groups = { desserts: [], drinks: [], other: [] };
for (const [name, sales] of Object.entries(period.categories)) groups[groupOf(name)].push([name, sales]);
for (const [group, list] of Object.entries(groups)) {
  const total = list.reduce((s, [, v]) => s + v, 0);
  console.log(`  ${group.padEnd(9)} ${money(total).padStart(12)}  ${list.length} categories`);
  if (group !== 'other') {
    for (const [n, v] of list.sort((a, b) => b[1] - a[1])) console.log(`      ${n.padEnd(34)} ${money(v)}`);
  }
}

if (unmapped.size) {
  console.log('\n  Unmapped (counted in Other — add to categories.mjs if any belong in a group):');
  for (const [n, v] of [...unmapped].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${n.padEnd(34)} ${money(v)}`);
  }
}

console.log(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
