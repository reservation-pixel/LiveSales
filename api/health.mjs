import { kvAvailable, kvConfig } from '../kv.mjs';
import { credentialsFromEnv } from '../petpooja.mjs';
import { ACTIVE, INACTIVE } from '../outlets.mjs';
import { guard, json } from './_lib.mjs';

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
  json(res, 200, {
    mode: 'serverless',
    kv: kvAvailable() ? 'configured' : 'MISSING',
    kvUrlHost: kvConfig().url ? new URL(kvConfig().url).host : null,
    credentials: creds ?? 'MISSING',
    credError,
    outlets: { reporting: ACTIVE.length, withoutOrdersApi: INACTIVE.length },
    note: 'Data is fetched per request and cached in KV; there is no background poll.',
  });
});
