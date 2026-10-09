// Petpooja Orders API client.
//
// POST, although the vendor docs say GET. The docs describe a GET carrying a
// JSON body, which worked until Petpooja put CloudFront in front of the API in
// Oct 2026. CloudFront rejects any GET with a body as a 403 "Bad request" HTML
// page before it reaches Petpooja, which took every outlet offline at once.
// The same body sent as a POST is answered normally. Do not switch it back to
// GET to match the docs.
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
  // Whitespace is the classic dashboard-paste failure: a trailing newline makes
  // a value that looks identical and is rejected upstream.
  for (const k of Object.keys(creds)) creds[k] = creds[k].trim();

  // A dropped character surfaces as a confusing upstream message — "Invalid
  // client credentials." for the key or secret, "Invalid Token." for the token
  // — with no hint which value is at fault. Catch it here, where it can say so.
  const LENGTHS = { app_key: 32, app_secret: 40, access_token: 40 };
  for (const [k, want] of Object.entries(LENGTHS)) {
    if (creds[k].length !== want) {
      throw new Error(
        `PP_${k.toUpperCase()} should be ${want} characters, got ${creds[k].length}. ` +
          'Check for a truncated or mis-pasted value.',
      );
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
        method: 'POST',
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
