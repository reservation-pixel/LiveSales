// Upstash Redis over its REST API. No SDK, no dependency — the whole surface
// this app needs is GET, SET and a pipeline, and each is one HTTPS call.
//
// The Vercel KV and Upstash integrations inject differently-named variables
// depending on which one is installed and when, so both spellings are accepted
// rather than making the deployment depend on guessing right.

const URL_VARS = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];
const TOKEN_VARS = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];

const pick = (names, env) => names.map((n) => env[n]).find(Boolean) || null;

export const kvConfig = (env = process.env) => ({
  url: pick(URL_VARS, env),
  token: pick(TOKEN_VARS, env),
});

/** True when a KV store is wired up. Absent locally, where disk is used. */
export const kvAvailable = (env = process.env) => {
  const { url, token } = kvConfig(env);
  return Boolean(url && token);
};

const call = async (body, env) => {
  const { url, token } = kvConfig(env);
  if (!url || !token) throw new Error('KV is not configured');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`KV ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
};

/**
 * Read many keys in one round trip.
 *
 * Reading 60 day-keys one at a time would be 60 sequential round trips, which
 * on its own would blow a serverless function's time budget. Missing keys come
 * back as null.
 *
 * @returns {Promise<Map<string, any>>} only the keys that were present
 */
export const kvGetMany = async (keys, env = process.env) => {
  const out = new Map();
  if (!keys.length) return out;

  // Upstash caps a pipeline body; chunk rather than risk a 413 on a wide range.
  const CHUNK = 128;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const rows = await call(slice.map((k) => ['GET', k]), env);
    rows.forEach((row, j) => {
      if (row?.result == null) return;
      try {
        out.set(slice[j], JSON.parse(row.result));
      } catch {
        // A corrupt value is treated as absent, so it gets refetched and
        // overwritten rather than poisoning every period that includes it.
      }
    });
  }
  return out;
};

/** Write many key/value pairs in one round trip. Values are JSON-encoded. */
export const kvSetMany = async (entries, env = process.env) => {
  if (!entries.length) return;
  const CHUNK = 64;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await call(
      entries.slice(i, i + CHUNK).map(([k, v]) => ['SET', k, JSON.stringify(v)]),
      env,
    );
  }
};
