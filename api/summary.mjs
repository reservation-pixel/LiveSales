import { resolve } from '../periods.mjs';
import { summarise } from '../summarise.mjs';
import { guard, json, readPeriod, storeFor } from './_lib.mjs';

export const config = { maxDuration: 60 };

export default guard(async (req, res) => {
  let range;
  try {
    const p = readPeriod(req.query);
    range = resolve(p.granularity, p.anchor, { rolling: p.rolling, to: p.to });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  const store = storeFor(45_000);
  // Both ranges in one pass: the comparison is as load-bearing as the period
  // itself, and fetching it separately would double the round trips.
  await store.load([...range.dates, ...range.prev.dates]);

  const body = summarise(store, range);
  // `truncated` means the budget ran out with days still missing. The page
  // already renders a partial period honestly and will ask again.
  body.truncated = store.truncated;
  body.upstreamCalls = store.fetched;
  if (store.kvError) body.kvError = store.kvError;
  json(res, 200, body);
});
