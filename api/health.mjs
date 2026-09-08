import { kvAvailable, kvConfig } from '../kv.mjs';
import { credentialsFromEnv } from '../petpooja.mjs';
import { ACTIVE, INACTIVE } from '../outlets.mjs';
import { createHash } from 'node:crypto';
import { guard, json } from './_lib.mjs';

// Enough to compare a deployed value against a local one without ever putting
// a secret in an HTTP response.
const fingerprint = (v) =>
  !v
    ? null
    : {
        len: v.length,
        first4: v.slice(0, 4),
        last4: v.slice(-4),
        sha8: createHash('sha256').update(v).digest('hex').slice(0, 8),
      };

export const config = { maxDuration: 30 };

// Reports what is configured, not what was fetched. Nothing survives between
// invocations, so there is no poll loop or cache state to describe — saying
// otherwise would be the lie the old deployment told with `cachedDays: 0`.
export default guard(async (req, res) => {
  let creds = null;
  let credError = null;
  try {
    credentialsFromEnv();
    creds = 'present';
  } catch (err) {
    credError = err.message;
  }
  const cached = kvAvailable();
  json(res, 200, {
    mode: 'serverless',
    // Optional. Without it the dashboard still works, it just refetches every
    // time instead of remembering closed days.
    cache: cached ? 'kv' : 'none',
    kvUrlHost: cached ? new URL(kvConfig().url).host : null,
    credentials: creds ?? 'MISSING',
    credError,
    // Compare these against the local values to spot a mis-pasted env var.
    // A differing sha8 with a matching length is a wrong value; a differing
    // length is a truncated one.
    credFingerprints: {
      PP_APP_KEY: fingerprint(process.env.PP_APP_KEY),
      PP_APP_SECRET: fingerprint(process.env.PP_APP_SECRET),
      PP_ACCESS_TOKEN: fingerprint(process.env.PP_ACCESS_TOKEN),
      PP_COOKIE: fingerprint(process.env.PP_COOKIE),
    },
    outlets: { reporting: ACTIVE.length, withoutOrdersApi: INACTIVE.length },
    note: cached
      ? 'Closed days are cached in KV and fetched once. Only today expires.'
      : 'No cache: every request refetches. Daily ~2s, Weekly ~10s, a full Month may exceed the time budget and return partial figures — add an Upstash KV integration to fix that.',
  });
});
