// Petpooja Orders API client.
//
// Deliberately node:https and not fetch. The endpoint is a GET that carries a
// JSON body, and undici refuses that outright:
//   TypeError: Request with GET/HEAD method cannot have body.
// curl and node:https both send it fine, and Petpooja answers 200.
//
// Two behaviours of this API that the rest of the codebase depends on:
//   1. A call for date D returns orders for BOTH D and D-1. Callers must filter
//      on Order.order_date; nothing here trims the payload.
//   2. It is genuinely live — a call at 17:44 returned an order billed at 14:30
//      the same day. The vendor docs describe it as T-1; they are out of date.

import { request } from 'node:https';

const HOST = 'api.petpooja.com';
const PATH = '/V1/thirdparty/generic_get_orders/';

const TIMEOUT_MS = 30_000;
const RETRIES = 2;
const RETRY_BASE_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const credentialsFromEnv = (env = process.env) => {
  const creds = {
    app_key: env.PP_APP_KEY,
    app_secret: env.PP_APP_SECRET,
    access_token: env.PP_ACCESS_TOKEN,
    cookie: env.PP_COOKIE,
  };
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => `PP_${k.toUpperCase()}`);
  if (missing.length) {
    throw new Error(
      `Missing credentials: ${missing.join(', ')}. Copy .env.example to .env and run with --env-file=.env`,
    );
  }
  // A dropped character in a 40-char token surfaces as a confusing "Invalid
  // Token (GN_102)" from upstream. Catch it here where the message can say why.
  for (const k of ['app_secret', 'access_token']) {
    if (creds[k].length !== 40) {
      throw new Error(`PP_${k.toUpperCase()} should be 40 characters, got ${creds[k].length}`);
    }
  }
  return creds;
};

const once = (creds, restID, date) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      app_key: creds.app_key,
      app_secret: creds.app_secret,
      access_token: creds.access_token,
      restID,
      order_date: date,
      refId: '',
    });

    const req = request(
      {
        host: HOST,
        path: PATH,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Cookie: creds.cookie,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            // An HTML error page means the request never reached the API.
            return reject(new Error(`Non-JSON response: ${text.slice(0, 200)}`));
          }
          // The API answers 200 with code "100"/"101" for its own errors, so
          // the HTTP status alone is not enough to call this a success.
          if (String(body.code) !== '200' || String(body.success) !== '1') {
            return reject(new Error(`Petpooja ${body.code}: ${body.message || 'unknown error'}`));
          }
          resolve(Array.isArray(body.order_json) ? body.order_json : []);
        });
      },
    );

    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`No response in ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
    req.end(payload);
  });

/**
 * Fetch raw orders for one outlet. Returns orders for `date` AND `date - 1`.
 *
 * Never throws: the poll loop runs unattended and one failing outlet must not
 * stop the other five. The caller decides what an error looks like on screen.
 *
 * @returns {Promise<{ok: boolean, orders: object[], error: string|null, ms: number}>}
 */
export const fetchOrders = async (creds, restID, date) => {
  const started = Date.now();
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const orders = await once(creds, restID, date);
      return { ok: true, orders, error: null, ms: Date.now() - started };
    } catch (err) {
      lastError = err;
      // A rejected credential or an unmapped restaurant will not fix itself on
      // a retry; only wait for what looks transient.
      if (/Invalid Token|restaurant mapping|GN_10/i.test(err.message)) break;
      if (attempt < RETRIES) await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  return { ok: false, orders: [], error: lastError.message, ms: Date.now() - started };
};
