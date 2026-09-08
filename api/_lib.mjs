// Shared setup for the serverless handlers.

import { credentialsFromEnv } from '../petpooja.mjs';
import { KvStore } from '../store-kv.mjs';
import { GRANULARITIES, daysBetween, isDateKey, today } from '../periods.mjs';

const MAX_CUSTOM_DAYS = 366;

export const json = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json');
  // Figures change every minute; a cached response would show stale takings.
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

/** Same validation as the local server — rejects rather than clamps. */
export const readPeriod = (q) => {
  const granularity = q.granularity || 'day';
  if (!GRANULARITIES.includes(granularity)) {
    throw new Error(`granularity must be one of ${GRANULARITIES.join(', ')}`);
  }
  const anchor = q.anchor || today();
  if (!isDateKey(anchor)) throw new Error('anchor must be YYYY-MM-DD');
  if (anchor > today()) throw new Error('anchor cannot be in the future');

  let to;
  if (granularity === 'custom') {
    to = q.to;
    if (!isDateKey(to)) throw new Error('custom needs a `to` date as YYYY-MM-DD');
    if (to < anchor) throw new Error('`to` cannot be before `anchor`');
    if (to > today()) throw new Error('`to` cannot be in the future');
    const days = daysBetween(anchor, to) + 1;
    if (days > MAX_CUSTOM_DAYS) {
      throw new Error(`custom range is ${days} days; the maximum is ${MAX_CUSTOM_DAYS}`);
    }
  }
  return { granularity, anchor, to, rolling: q.rolling === 'true' };
};

/**
 * A store for one request. Nothing survives between invocations, so this is
 * built fresh each time and warmed from KV — which is the whole reason the
 * cache lives there rather than in memory or on disk.
 */
export const storeFor = (budgetMs) => new KvStore({ creds: credentialsFromEnv(), budgetMs });

/** Turns a thrown credential or config error into a readable 500. */
export const guard = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    json(res, /credentials/i.test(err.message) ? 503 : 500, { error: err.message });
  }
};
