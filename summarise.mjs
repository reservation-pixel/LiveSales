// Turning a resolved period into the payload the dashboard renders.
//
// Extracted so the long-running server and the Vercel function share one
// implementation. Two copies of this would drift, and the figures they disagree
// about would be the ones on screen.

import { ACTIVE, BRANDS, INACTIVE, INACTIVE_REASON, outletsOfBrand } from './outlets.mjs';
import { combine, sumDays, truncateToHour, delta, pointDelta } from './aggregate.mjs';
import { bucketsFor, today } from './periods.mjs';

export const summarise = (store, range) => {
  // A period ending today has only part-traded. Cutting the matching day of the
  // previous period at the same hour is what stops the headline reading -90% at
  // six in the evening, when the real answer is "the evening hasn't happened".
  // The last day of prev always corresponds to today: both ranges are the same
  // length and the current one ends on it.
  const now = new Date();
  const live = range.includesToday && range.to === today();
  const cutHour = live ? now.getHours() : null;
  const cutFraction = live ? (now.getMinutes() * 60 + now.getSeconds()) / 3600 : 0;
  const lastPrev = range.prev.dates[range.prev.dates.length - 1];

  const prevDays = (outletId) =>
    store.range(outletId, range.prev.dates).map((d) =>
      cutHour != null && d.date === lastPrev ? truncateToHour(d, cutHour, cutFraction) : d,
    );

  const perOutlet = new Map();
  for (const outlet of ACTIVE) {
    perOutlet.set(outlet.id, {
      now: sumDays(store.range(outlet.id, range.dates)),
      prev: sumDays(prevDays(outlet.id)),
    });
  }

  const compare = (now, prev) => ({
    totalSales: now.totalSales,
    prevTotalSales: prev.totalSales,
    salesDelta: delta(now.totalSales, prev.totalSales),
    menuSales: now.menuSales,
    adjustments: now.adjustments,
    orders: now.orders,
    prevOrders: prev.orders,
    aov: now.aov,
    aovDelta: delta(now.aov, prev.aov),
    dessertPct: now.dessertPct,
    dessertPctDelta: pointDelta(now.dessertPct, prev.dessertPct),
    dessertSales: now.groups.desserts,
    drinkPct: now.drinkPct,
    drinkPctDelta: pointDelta(now.drinkPct, prev.drinkPct),
    drinkSales: now.groups.drinks,
    otherSales: now.groups.other,
    // A day view has one daily point and nothing to plot, so it gets its own
    // hourly service curve instead. Both shapes carry {totalSales, groups}, so
    // the page renders either without knowing which it received.
    series: range.granularity === 'day' ? now.hours : now.days,
  });

  const outlets = ACTIVE.map((o) => {
    const { now, prev } = perOutlet.get(o.id);
    return { id: o.id, name: o.name, brand: o.brand, ...compare(now, prev) };
  });

  const brands = BRANDS.map((brand) => {
    const ids = outletsOfBrand(brand).map((o) => o.id);
    const now = combine(ids.map((id) => perOutlet.get(id).now));
    const prev = combine(ids.map((id) => perOutlet.get(id).prev));
    return { brand, outlets: ids.length, ...compare(now, prev) };
  });

  const allNow = combine([...perOutlet.values()].map((v) => v.now));
  const allPrev = combine([...perOutlet.values()].map((v) => v.prev));

  const unmapped = Object.entries(allNow.unmapped)
    .map(([name, sales]) => ({ name, sales }))
    .sort((a, b) => b.sales - a.sales);

  return {
    period: {
      granularity: range.granularity,
      rolling: range.rolling,
      anchor: range.anchor,
      from: range.from,
      to: range.to,
      label: range.label,
      open: range.open,
      live: range.includesToday,
      days: range.dates.length,
      prevLabel: range.prev.label,
      prevDays: range.prev.dates.length,
      // So the page can say the comparison stops at the same time of day.
      comparedToHour: cutHour,
      buckets: bucketsFor(range).kind,
    },
    total: compare(allNow, allPrev),
    brands,
    outlets,
    unmapped,
    notReporting: INACTIVE.map((o) => ({ id: o.id, name: o.name, brand: o.brand })),
    notReportingReason: INACTIVE_REASON,
    health: store.healthReport(),
    backfilling: store.backfill.running ? store.backfill : null,
    // What the calendar may offer. Anything outside this has no data behind it.
    available: store.span(),
    // False only in the moment between the port opening and the cache being
    // read. Distinguishes "no sales" from "nothing loaded yet".
    ready: store.ready,
    complete: store.covers(range.dates),
    // A delta against a period that is not fully loaded is not a small error,
    // it is a wrong number: an uncached June makes July look like +2203%.
    prevComplete: store.covers(range.prev.dates),
    generatedAt: Date.now(),
  };
};
