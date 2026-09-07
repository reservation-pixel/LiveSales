// Orders → numbers.
//
// Aggregation is per outlet-day and is only ever summed upward. A month view is
// thirty cached day aggregates added together, never a re-read of raw orders,
// which is what makes switching period instant and free of API traffic.
//
// Revenue basis is GROSS — inclusive of GST — because that is the figure that
// matches the till. Two totals are therefore kept, and they are not the same:
//
//   totalSales  Σ Order.total          the headline; what guests paid
//   menuSales   Σ (item.total + item.total_tax)   the mix denominator
//
// They differ by order-level discounts, delivery and container charges, service
// charge, tips and round-off — money that belongs to no menu category. Dividing
// desserts by totalSales would give shares that never reach 100% and cannot be
// reconciled, so the residual is carried explicitly as `adjustments` instead of
// being hidden in a rounding gap.

import { DESSERTS, DRINKS, OTHER, groupOf, isMapped } from './categories.mjs';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const round = (n) => Math.round(n * 100) / 100;
// Percentages and deltas are shown to one decimal place; rounding them through
// `round` first would leave 5.446 rather than 5.4.
const round1 = (n) => Math.round(n * 10) / 10;

export const emptyDay = (outletId, date) => ({
  outletId,
  date,
  totalSales: 0,
  menuSales: 0,
  adjustments: 0,
  orders: 0,
  groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
  categories: {},
  unmapped: {},
  // Per-hour buckets carry the group split, not just revenue, so a live day can
  // be compared against the same hours of the previous one with its mix intact.
  hours: Array.from({ length: 24 }, () => ({
    totalSales: 0,
    orders: 0,
    groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
  })),
});

/**
 * Aggregate one outlet's orders for one date.
 *
 * `orders` is the raw order_json array, which spans two days — everything not
 * on `date` is dropped here, not by the caller.
 */
export const aggregateDay = (outletId, date, orders) => {
  const day = emptyDay(outletId, date);

  for (const entry of orders) {
    const order = entry?.Order;
    if (!order || order.order_date !== date) continue;
    // Cancelled orders are present in the feed and would inflate every figure.
    if (order.status !== 'Success') continue;

    day.orders += 1;
    day.totalSales += num(order.total);

    const hour = Number((order.created_on || '').slice(11, 13));
    const bucket = Number.isInteger(hour) && hour >= 0 && hour < 24 ? day.hours[hour] : null;
    if (bucket) {
      bucket.totalSales += num(order.total);
      bucket.orders += 1;
    }

    for (const item of entry.OrderItem || []) {
      // Item gross. Verified against live payloads: summed across an order this
      // equals Order.total apart from the order-level adjustments above.
      const gross = num(item.total) + num(item.total_tax);
      const name = item.categoryname || '(uncategorised)';
      const group = groupOf(name);

      day.menuSales += gross;
      day.groups[group] += gross;
      if (bucket) bucket.groups[group] += gross;
      day.categories[name] = (day.categories[name] || 0) + gross;
      if (!isMapped(name)) day.unmapped[name] = (day.unmapped[name] || 0) + gross;
    }
  }

  day.adjustments = round(day.totalSales - day.menuSales);
  day.totalSales = round(day.totalSales);
  day.menuSales = round(day.menuSales);
  for (const k of Object.keys(day.groups)) day.groups[k] = round(day.groups[k]);
  for (const k of Object.keys(day.categories)) day.categories[k] = round(day.categories[k]);
  for (const k of Object.keys(day.unmapped)) day.unmapped[k] = round(day.unmapped[k]);
  for (const b of day.hours) {
    b.totalSales = round(b.totalSales);
    for (const g of Object.keys(b.groups)) b.groups[g] = round(b.groups[g]);
  }
  return day;
};

/**
 * The same day cut off part-way through `hour`.
 *
 * A live day is only part-traded, so setting it against a complete previous day
 * reports a collapse that is really just the clock: at 18:00 a restaurant has
 * not served its evening yet. Truncating the comparison to the same point is
 * what makes "vs yesterday" mean anything before closing time.
 *
 * `fraction` is how much of `hour` has elapsed. Cutting on the hour boundary
 * instead would leave today holding a partial hour that yesterday is not
 * credited with — a small bias, but always in the flattering direction.
 *
 * Only totals, order counts and the group split survive — the per-category
 * detail is not stored per hour, and is not needed for a comparison figure.
 */
export const truncateToHour = (day, hour, fraction = 0) => {
  if (!day || hour >= 24) return day;
  const cut = {
    ...emptyDay(day.outletId, day.date),
    truncatedAt: hour,
  };
  for (let h = 0; h <= Math.min(23, Math.max(0, hour)); h += 1) {
    const b = day.hours[h];
    if (!b) continue;
    // The hour in progress counts only as far as the clock has gone.
    const share = h === hour ? Math.min(1, Math.max(0, fraction)) : 1;
    if (share === 0) continue;
    cut.totalSales += b.totalSales * share;
    cut.orders += Math.round(b.orders * share);
    for (const g of Object.keys(cut.groups)) cut.groups[g] += (b.groups[g] || 0) * share;
    cut.hours[h] = share === 1 ? b : {
      totalSales: round(b.totalSales * share),
      orders: Math.round(b.orders * share),
      groups: Object.fromEntries(Object.entries(b.groups).map(([g, v]) => [g, round(v * share)])),
    };
  }
  cut.menuSales = round(Object.values(cut.groups).reduce((a, b) => a + b, 0));
  cut.totalSales = round(cut.totalSales);
  for (const g of Object.keys(cut.groups)) cut.groups[g] = round(cut.groups[g]);
  cut.adjustments = round(cut.totalSales - cut.menuSales);
  return cut;
};

const addHours = (target, src) => {
  if (!src) return;
  for (let h = 0; h < 24; h += 1) {
    const from = src[h];
    if (!from) continue;
    target[h].totalSales = round(target[h].totalSales + from.totalSales);
    target[h].orders += from.orders;
    for (const g of Object.keys(target[h].groups)) {
      target[h].groups[g] = round(target[h].groups[g] + (from.groups[g] || 0));
    }
  }
};

const addInto = (target, src) => {
  for (const [k, v] of Object.entries(src)) target[k] = round((target[k] || 0) + v);
};

/**
 * Sum day aggregates into one figure set.
 *
 * Percentages and AOV are recomputed from the summed totals, never averaged
 * across days: the mean of daily dessert shares is not the period's dessert
 * share, and on a quiet Monday the two diverge sharply.
 */
export const sumDays = (days) => {
  const out = {
    totalSales: 0,
    menuSales: 0,
    adjustments: 0,
    orders: 0,
    groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
    categories: {},
    unmapped: {},
    days: [],
  hours: Array.from({ length: 24 }, () => ({
      totalSales: 0,
      orders: 0,
      groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
    })),
  };

  for (const d of days) {
    if (!d) continue;
    out.totalSales += d.totalSales;
    out.menuSales += d.menuSales;
    out.adjustments += d.adjustments;
    out.orders += d.orders;
    for (const g of Object.keys(out.groups)) out.groups[g] += d.groups[g] || 0;
    addInto(out.categories, d.categories);
    addInto(out.unmapped, d.unmapped);
    out.days.push({ date: d.date, totalSales: d.totalSales, groups: d.groups, orders: d.orders });
    // Summed across days this is the trading-day profile; over a single day it
    // is that day's service curve, which is the only trend a day view can show.
    addHours(out.hours, d.hours);
  }

  out.totalSales = round(out.totalSales);
  out.menuSales = round(out.menuSales);
  out.adjustments = round(out.adjustments);
  for (const g of Object.keys(out.groups)) out.groups[g] = round(out.groups[g]);
  return withDerived(out);
};

/** Shares and AOV, derived once so no caller has to remember the denominator. */
export const withDerived = (agg) => {
  const share = (v) => (agg.menuSales > 0 ? round1((v / agg.menuSales) * 100) : null);
  return {
    ...agg,
    aov: agg.orders > 0 ? round(agg.totalSales / agg.orders) : null,
    dessertPct: share(agg.groups[DESSERTS]),
    drinkPct: share(agg.groups[DRINKS]),
    otherPct: share(agg.groups[OTHER]),
  };
};

/** Percentage change, or null where there is no base to compare against. */
export const delta = (now, before) => {
  if (before == null || now == null || before === 0) return null;
  return round1(((now - before) / before) * 100);
};

/** Difference in percentage points — for comparing two shares. */
export const pointDelta = (now, before) =>
  now == null || before == null ? null : round1(now - before);

/** Roll several outlet aggregates into one, for a brand or the whole group. */
export const combine = (aggs) => {
  const merged = {
    totalSales: 0,
    menuSales: 0,
    adjustments: 0,
    orders: 0,
    groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
    categories: {},
    unmapped: {},
    days: [],
  hours: Array.from({ length: 24 }, () => ({
      totalSales: 0,
      orders: 0,
      groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
    })),
  };
  const byDate = new Map();

  for (const a of aggs) {
    merged.totalSales += a.totalSales;
    merged.menuSales += a.menuSales;
    merged.adjustments += a.adjustments;
    merged.orders += a.orders;
    for (const g of Object.keys(merged.groups)) merged.groups[g] += a.groups[g] || 0;
    addInto(merged.categories, a.categories);
    addInto(merged.unmapped, a.unmapped);
    addHours(merged.hours, a.hours);
    for (const d of a.days || []) {
      const acc = byDate.get(d.date) || {
        date: d.date,
        totalSales: 0,
        orders: 0,
        groups: { [DESSERTS]: 0, [DRINKS]: 0, [OTHER]: 0 },
      };
      acc.totalSales = round(acc.totalSales + d.totalSales);
      acc.orders += d.orders;
      for (const g of Object.keys(acc.groups)) acc.groups[g] = round(acc.groups[g] + (d.groups[g] || 0));
      byDate.set(d.date, acc);
    }
  }

  merged.totalSales = round(merged.totalSales);
  merged.menuSales = round(merged.menuSales);
  merged.adjustments = round(merged.adjustments);
  for (const g of Object.keys(merged.groups)) merged.groups[g] = round(merged.groups[g]);
  merged.days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return withDerived(merged);
};
