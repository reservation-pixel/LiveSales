// node --test periods.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, step, addDays, datesInRange, rangeLabel, bucketsFor } from './periods.mjs';

const NOW = '2026-09-07'; // a Monday

test('day range is one date, compared with the day before', () => {
  const r = resolve('day', '2026-09-05', { now: NOW });
  assert.deepEqual(r.dates, ['2026-09-05']);
  assert.equal(r.prev.from, '2026-09-04');
  assert.deepEqual(r.prev.dates, ['2026-09-04']);
  assert.equal(r.label, 'Sat 5 Sep 2026');
});

test('weeks run Monday to Sunday', () => {
  const monday = resolve('week', '2026-09-07', { now: '2026-09-13' });
  const sunday = resolve('week', '2026-09-13', { now: '2026-09-13' });
  assert.equal(monday.from, '2026-09-07');
  assert.equal(monday.fullTo, '2026-09-13');
  // A Sunday belongs to the week that began six days earlier, not the next one.
  assert.equal(sunday.from, monday.from, 'Sunday resolves to the same week as its Monday');
});

test('previous week is the seven days before, not an overlapping window', () => {
  const r = resolve('week', '2026-09-07', { now: '2026-09-13' });
  assert.equal(r.prev.from, '2026-08-31');
  assert.equal(r.prev.to, '2026-09-06');
  assert.equal(r.prev.dates.length, 7);
});

test('month range is the calendar month and does not leak the previous one', () => {
  const r = resolve('month', '2026-08-01', { now: NOW });
  assert.equal(r.from, '2026-08-01');
  assert.equal(r.to, '2026-08-31');
  assert.equal(r.dates.length, 31);
  assert.equal(r.label, 'Aug 2026');
  assert.equal(r.prev.from, '2026-07-01');
  assert.equal(r.prev.to, '2026-07-31');
});

test('a partial month is compared against the same number of days', () => {
  // The whole point: 7 days of September must not be set against 31 of August.
  const r = resolve('month', NOW, { now: NOW });
  assert.equal(r.to, NOW, 'current period stops at today, not the 30th');
  assert.equal(r.open, true);
  assert.equal(r.dates.length, 7);
  assert.equal(r.prev.from, '2026-08-01');
  assert.equal(r.prev.to, '2026-08-07');
  assert.equal(r.prev.dates.length, 7, 'like for like');
  assert.equal(r.prev.label, '1–7 Aug 2026');
});

test('a partial week is compared against the same number of days', () => {
  const r = resolve('week', NOW, { now: NOW }); // Monday, one day in
  assert.equal(r.dates.length, 1);
  assert.equal(r.prev.from, '2026-08-31');
  assert.equal(r.prev.to, '2026-08-31');
});

test('a full month meets the whole previous month, whatever its length', () => {
  // July has 31 days and June 30. Carrying the day count across would end the
  // comparison on 1 July — a day of the month being compared.
  const jul = resolve('month', '2026-07-15', { now: NOW });
  assert.equal(jul.prev.from, '2026-06-01');
  assert.equal(jul.prev.to, '2026-06-30');
  assert.equal(jul.prev.label, 'Jun 2026');

  const mar = resolve('month', '2026-03-15', { now: NOW });
  assert.equal(mar.prev.to, '2026-02-28', 'February, not a 31-day slice of it');

  const jan = resolve('month', '2026-01-15', { now: NOW });
  assert.equal(jan.prev.from, '2025-12-01');
  assert.equal(jan.prev.to, '2025-12-31');
});

test('a closed period is not truncated', () => {
  const r = resolve('month', '2026-07-15', { now: NOW });
  assert.equal(r.open, false);
  assert.equal(r.includesToday, false);
  assert.equal(r.dates.length, 31);
});

test('includesToday drives whether the view is live', () => {
  assert.equal(resolve('day', NOW, { now: NOW }).includesToday, true);
  assert.equal(resolve('day', '2026-09-06', { now: NOW }).includesToday, false);
  assert.equal(resolve('month', NOW, { now: NOW }).includesToday, true);
});

test('rolling windows are last-7 and last-30 ending at the anchor', () => {
  const w = resolve('week', NOW, { rolling: true, now: NOW });
  assert.equal(w.from, '2026-09-01');
  assert.equal(w.to, NOW);
  assert.equal(w.prev.from, '2026-08-25');
  assert.equal(w.prev.to, '2026-08-31');

  const m = resolve('month', NOW, { rolling: true, now: NOW });
  assert.equal(m.from, '2026-08-09');
  assert.equal(m.dates.length, 30);
});

test('step moves by whole periods', () => {
  assert.equal(step('day', '2026-09-07', -1), '2026-09-06');
  assert.equal(step('week', '2026-09-09', -1), '2026-08-31', 'normalises to the week start first');
  assert.equal(step('month', '2026-09-07', -1), '2026-08-01');
  assert.equal(step('month', '2026-01-15', -1), '2025-12-01', 'crosses the year boundary');
  assert.equal(step('month', '2026-12-15', 1), '2027-01-01');
});

test('month lengths and leap years', () => {
  assert.equal(resolve('month', '2026-02-10', { now: NOW }).dates.length, 28);
  assert.equal(resolve('month', '2024-02-10', { now: NOW }).dates.length, 29);
  assert.equal(resolve('month', '2026-04-10', { now: NOW }).dates.length, 30);
});

test('date arithmetic survives DST-free UTC handling and month ends', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(datesInRange('2026-09-05', '2026-09-07').length, 3);
});

test('range labels read as English', () => {
  assert.equal(rangeLabel('2026-09-07', '2026-09-07', 'day'), 'Mon 7 Sep 2026');
  assert.equal(rangeLabel('2026-08-01', '2026-08-07'), '1–7 Aug 2026');
  assert.equal(rangeLabel('2026-08-31', '2026-09-06'), '31 Aug – 6 Sep 2026');
  assert.equal(rangeLabel('2025-12-29', '2026-01-04'), '29 Dec 2025 – 4 Jan 2026');
});

test('buckets are hourly for a day and daily otherwise', () => {
  assert.deepEqual(bucketsFor(resolve('day', NOW, { now: NOW })).kind, 'hour');
  assert.equal(bucketsFor(resolve('day', NOW, { now: NOW })).keys.length, 24);
  const m = resolve('month', '2026-08-01', { now: NOW });
  assert.equal(bucketsFor(m).kind, 'day');
  assert.equal(bucketsFor(m).keys.length, 31);
});
