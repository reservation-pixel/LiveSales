// /api/outlet?id=<outletId> — the expanded category breakdown for one outlet.
//
// A query parameter rather than a path segment, because a file-based route
// would need api/outlet/[id].mjs and the client already builds the URL.

import { BY_ID } from '../outlets.mjs';
import { sumDays } from '../aggregate.mjs';
import { groupOf, GROUP_LABELS } from '../categories.mjs';
import { resolve } from '../periods.mjs';
import { guard, json, readPeriod, storeFor } from './_lib.mjs';

export const config = { maxDuration: 60 };

export default guard(async (req, res) => {
  const outlet = BY_ID.get(req.query.id);
  if (!outlet || !outlet.active) return json(res, 404, { error: 'Unknown outlet' });

  let range;
  try {
    const p = readPeriod(req.query);
    range = resolve(p.granularity, p.anchor, { rolling: p.rolling, to: p.to });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  const store = storeFor(45_000);
  await store.load(range.dates);

  const now = sumDays(store.range(outlet.id, range.dates));
  const categories = Object.entries(now.categories)
    .map(([name, sales]) => ({
      name,
      sales,
      share: now.menuSales > 0 ? Math.round((sales / now.menuSales) * 1000) / 10 : null,
      group: now.unmapped[name] != null ? 'unmapped' : groupOf(name),
    }))
    .sort((a, b) => b.sales - a.sales);

  json(res, 200, {
    outlet: { id: outlet.id, name: outlet.name, brand: outlet.brand },
    period: { label: range.label, from: range.from, to: range.to },
    totalSales: now.totalSales,
    menuSales: now.menuSales,
    adjustments: now.adjustments,
    groups: now.groups,
    groupLabels: GROUP_LABELS,
    categories,
  });
});
