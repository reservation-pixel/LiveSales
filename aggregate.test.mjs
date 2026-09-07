// node --test aggregate.test.mjs
// Unit tests on synthetic orders. For the same assertions against live
// payloads, see verify.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDay, sumDays, combine, truncateToHour, delta, pointDelta } from './aggregate.mjs';

const order = ({ date = '2026-09-07', status = 'Success', total, at = '14:30:00', items }) => ({
  Order: { order_date: date, status, total: String(total), created_on: `${date} ${at}` },
  OrderItem: items.map(([categoryname, net, tax = 0]) => ({
    categoryname,
    total: String(net),
    total_tax: String(tax),
  })),
});

test('gross basis: totals include tax, adjustments absorb the rest', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({ total: 2793, items: [['Sides', 2660, 133]] }),
  ]);
  assert.equal(d.totalSales, 2793);
  assert.equal(d.menuSales, 2793);
  assert.equal(d.adjustments, 0);
});

test('order-level charges land in adjustments, not in a category', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({ total: 2900, items: [['Sides', 2660, 133]] }), // +107 delivery
  ]);
  assert.equal(d.menuSales, 2793);
  assert.equal(d.adjustments, 107);
  assert.equal(d.groups.desserts + d.groups.drinks + d.groups.other, d.menuSales);
});

test('cancelled orders are excluded entirely', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({ total: 1000, items: [['Drinks', 1000]] }),
    order({ total: 9999, status: 'Cancelled', items: [['Drinks', 9999]] }),
  ]);
  assert.equal(d.orders, 1);
  assert.equal(d.totalSales, 1000);
  assert.equal(d.groups.drinks, 1000);
});

test('the two-day payload is filtered to the requested date', () => {
  const raw = [
    order({ date: '2026-09-07', total: 100, items: [['Drinks', 100]] }),
    order({ date: '2026-09-06', total: 500, items: [['Drinks', 500]] }),
  ];
  assert.equal(aggregateDay('x', '2026-09-07', raw).totalSales, 100);
  assert.equal(aggregateDay('x', '2026-09-06', raw).totalSales, 500);
});

test('the decided mapping: coffee drinks, ice cream and cakes desserts', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({
      total: 700,
      items: [['Coffee', 100], ['beverages', 100], ['Ice Cream', 100], ['Cakes', 100],
              ['Cannoli & Mochi', 100], ['Chumma Chinese Sweet Endings', 100], ['Pizza', 100]],
    }),
  ]);
  assert.equal(d.groups.drinks, 200);
  assert.equal(d.groups.desserts, 400);
  assert.equal(d.groups.other, 100);
});

test('unrecognised categories are reported, not silently binned', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({ total: 300, items: [['Pizza', 100], ['Sourdough Club', 200]] }),
  ]);
  assert.equal(d.groups.other, 300, 'both counted in the totals');
  // Pizza is an explicitly mapped Other category; only the genuinely new name
  // is flagged. Otherwise the warning fires on 33 savoury categories forever
  // and a new dessert category hides among them.
  assert.deepEqual(d.unmapped, { 'Sourdough Club': 200 });
});

test('hourly buckets follow created_on and carry the group split', () => {
  const d = aggregateDay('x', '2026-09-07', [
    order({ total: 100, at: '09:15:00', items: [['Coffee', 100]] }),
    order({ total: 250, at: '21:05:00', items: [['Desserts', 250]] }),
  ]);
  assert.equal(d.hours[9].totalSales, 100);
  assert.equal(d.hours[9].groups.drinks, 100);
  assert.equal(d.hours[21].totalSales, 250);
  assert.equal(d.hours[21].groups.desserts, 250);
  assert.equal(d.hours.reduce((a, b) => a + b.totalSales, 0), 350);
});

test('truncating to an hour compares like with like mid-service', () => {
  // A full day: lunch, then a much bigger dinner.
  const full = aggregateDay('x', '2026-09-06', [
    order({ date: '2026-09-06', total: 1000, at: '13:00:00', items: [['Pizza', 900], ['Desserts', 100]] }),
    order({ date: '2026-09-06', total: 9000, at: '20:00:00', items: [['Pizza', 8000], ['Desserts', 1000]] }),
  ]);
  assert.equal(full.totalSales, 10000);

  // At 18:00 only lunch has happened, so only lunch may be compared.
  const cut = truncateToHour(full, 18, 0);
  assert.equal(cut.totalSales, 1000);
  assert.equal(cut.orders, 1);
  assert.equal(cut.groups.desserts, 100);
  assert.equal(sumDays([cut]).dessertPct, 10);

  // Comparing a part-traded day against the whole of the previous one is the
  // bug this exists to prevent: -90% when nothing is actually wrong.
  assert.equal(delta(1000, full.totalSales), -90);
  assert.equal(delta(1000, cut.totalSales), 0);
});

test('truncating past closing time changes nothing', () => {
  const full = aggregateDay('x', '2026-09-06', [
    order({ date: '2026-09-06', total: 500, at: '20:00:00', items: [['Pizza', 500]] }),
  ]);
  assert.equal(truncateToHour(full, 24).totalSales, 500);
  assert.equal(truncateToHour(full, 23, 1).totalSales, 500);
  assert.equal(truncateToHour(full, 0, 0).totalSales, 0, 'before opening, nothing to compare');
});

test('the hour in progress is pro-rated, not counted whole or dropped', () => {
  const full = aggregateDay('x', '2026-09-06', [
    order({ date: '2026-09-06', total: 1000, at: '19:30:00', items: [['Pizza', 1000]] }),
    order({ date: '2026-09-06', total: 400, at: '20:30:00', items: [['Pizza', 400]] }),
  ]);
  // 20:15 — a quarter of the way through the 20th hour.
  const cut = truncateToHour(full, 20, 0.25);
  assert.equal(cut.totalSales, 1100, '1000 complete + a quarter of 400');
  // Dropping the hour would understate yesterday and flatter today; counting it
  // whole would do the reverse.
  assert.equal(truncateToHour(full, 20, 0).totalSales, 1000);
  assert.equal(truncateToHour(full, 20, 1).totalSales, 1400);
});

test('period shares are weighted by revenue, not averaged across days', () => {
  // Day one: 50% desserts on ₹100. Day two: 5% desserts on ₹10,000.
  // The mean of the daily shares is 27.5%; the true period share is 5.4%.
  const busy = aggregateDay('x', '2026-09-06', [
    order({ date: '2026-09-06', total: 10000, items: [['Desserts', 500], ['Pizza', 9500]] }),
  ]);
  const quiet = aggregateDay('x', '2026-09-07', [
    order({ total: 100, items: [['Desserts', 50], ['Pizza', 50]] }),
  ]);
  const period = sumDays([busy, quiet]);
  assert.equal(period.totalSales, 10100);
  assert.equal(period.dessertPct, 5.4);
  assert.notEqual(period.dessertPct, 27.5);
});

test('a period equals the sum of its days, reached two ways', () => {
  const days = ['2026-09-05', '2026-09-06', '2026-09-07'].map((date, i) =>
    aggregateDay('x', date, [order({ date, total: 1000 * (i + 1), items: [['Drinks', 1000 * (i + 1)]] })]),
  );
  const period = sumDays(days);
  assert.equal(period.totalSales, days.reduce((s, d) => s + d.totalSales, 0));
  assert.equal(period.orders, 3);
  assert.equal(period.drinkPct, 100);
});

test('combine merges outlets and keeps a shared daily series', () => {
  const a = sumDays([aggregateDay('a', '2026-09-07', [order({ total: 100, items: [['Drinks', 100]] })])]);
  const b = sumDays([aggregateDay('b', '2026-09-07', [order({ total: 300, items: [['Desserts', 300]] })])]);
  const brand = combine([a, b]);
  assert.equal(brand.totalSales, 400);
  assert.equal(brand.drinkPct, 25);
  assert.equal(brand.dessertPct, 75);
  assert.equal(brand.days.length, 1, 'the same date from two outlets is one point');
  assert.equal(brand.days[0].totalSales, 400);
});

test('empty periods give null shares rather than NaN or a false zero', () => {
  const empty = sumDays([aggregateDay('x', '2026-09-07', [])]);
  assert.equal(empty.totalSales, 0);
  assert.equal(empty.dessertPct, null);
  assert.equal(empty.aov, null);
});

test('deltas refuse to divide by an absent base', () => {
  assert.equal(delta(150, 100), 50);
  assert.equal(delta(100, 0), null);
  assert.equal(delta(100, null), null);
  assert.equal(pointDelta(5.3, 4.1), 1.2);
  assert.equal(pointDelta(5.3, null), null);
});
