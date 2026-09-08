import { resolve } from '../periods.mjs';
import { summarise } from '../summarise.mjs';
import { kvAvailable } from '../kv.mjs';
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
  // Half of every request is the comparison period, which is needed only for
  // the deltas — and the page already renders honestly without them. So the
  // first phase fetches just what is on screen and answers roughly twice as
  // fast; the client then asks for the full thing and the deltas fill in.
  const currentOnly = req.query.phase === 'current';
  await store.load(currentOnly ? range.dates : [...range.dates, ...range.prev.dates]);

  const body = summarise(store, range);
  // `truncated` means the budget ran out with days still missing. The page
  // already renders a partial period honestly and will ask again.
  body.truncated = store.truncated;
  body.upstreamCalls = store.fetched;
  body.cached = kvAvailable();
  body.phase = currentOnly ? 'current' : 'full';
  body.warmHits = store.warmHits ?? 0;
  if (store.kvError) body.kvError = store.kvError;
  json(res, 200, body);
});
