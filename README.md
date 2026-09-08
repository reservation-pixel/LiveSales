# Live Sales

A dashboard over the Petpooja Orders API: sales by brand and by outlet, with the
share coming from desserts and from drinks, filterable by day, week or month.

No dependencies. Node 22+ and the built-ins.

```sh
cp .env.example .env      # fill in the BILLING credentials
node --env-file=.env server.mjs
open http://localhost:4000
```

First run takes five to ten minutes to backfill three months of history — about
200 calls, staggered — and serves the page immediately while it does, filling in
as days arrive. After that the history is on disk in
`data/` and only today is ever re-fetched. Navigating to an older period fetches
it — and its comparison period — in the background.

While a comparison period is still loading the page **hides the deltas** and says
so. A percentage change against a half-loaded month is not approximately right,
it is wrong: an uncached June made July read as +4,745%.

---

## What the numbers mean

**Total sales is gross — inclusive of GST.** It is `Σ Order.total`, the amount
guests actually paid, so it ties to the till.

**Shares are of menu sales**, which is `Σ (item.total + item.total_tax)`. The two
differ by delivery and container charges, service charge, tips, order-level
discounts and round-off — money that belongs to no menu category. That residual
is carried as **charges & adjustments** in the outlet detail panel rather than
smeared across the categories, so the figures reconcile:

```
menu sales  +  adjustments  =  total sales
desserts  +  drinks  +  other  =  menu sales
```

**Comparisons are like for like.** Two truncations make that true:

- A part-traded period is compared against the same number of days. On the 7th
  of the month, "this month" is 7 days, and the comparison is the 1st–7th of the
  previous month, not all 31. The bar says which — *vs 1–7 Aug 2026*.
- A live day is compared only up to the current hour. At 20:00 a restaurant has
  not served its late evening yet; against a complete previous day that reads as
  a collapse that never happened. The bar says *vs Sun 6 Sep to 20:00*.

**Cancelled orders are excluded.** They are present in the feed and would
otherwise inflate every figure.

---

## Which outlets appear

Six, across two brands — Aiko and Capiche. They are the only ones the Orders API
is enabled for.

The other eleven (Bookends mobile, both Bakeries, both Stores, Family, KG
Birthday Cake, ODC, ODC Store, both Prep Kitchens) return an empty array, not an
error. They are listed on the page under **Not reporting** rather than omitted,
because a brand total that silently excludes them looks like a decline rather
than a gap.

To add them, ask Petpooja to enable `generic_get_orders` for those RIDs — the
same request that was made for the six that work. That is an email to support,
not a code change; once enabled, flip `active: true` in `outlets.mjs`.

---

## Editing the dessert / drinks map

`categories.mjs`. Petpooja category names are free text typed per outlet, so the
live feed contains `Beverages` and `beverages` as two categories, alongside
`Drinks`, `Drinks [o]` and `Drinks (Beverages) [online]`. The map is therefore an
explicit list of the 47 names actually observed, not a keyword rule.

Matching folds case and strips the channel suffix Petpooja appends to online
duplicates (`[o]`, `[online]`, `[C]`, `(Online)`), so a new `Desserts [online]`
variant is picked up without an edit.

It also folds menu re-cuts. Outlets rebuild menus in place instead of renaming,
which leaves generations of the same category side by side — `New Drinks.`,
`NEW DESSERTS.`, `Desserts. [old]`, `11.Dips`. Across three months of history
that pattern accounts for **₹2.39L of drinks and ₹1.23L of desserts** that would
otherwise sit in Other and understate both shares. The folding runs only as a
fallback after the exact name misses, so an explicit entry always wins, and
anything it mangles surfaces as unrecognised rather than failing quietly.

Current decisions, as agreed:

| Group | Members |
|---|---|
| **Drinks** | Drinks · Beverages · Drinks (Beverages) [online] · Coffee · Coffee & Matcha · Chumma Chinese Cool The Mala |
| **Desserts** | Desserts · Cakes · Ice Cream (incl. Small / Medium) · Cannoli & Mochi · Bakery · Chumma Chinese Sweet Endings |
| **Other** | the savoury categories, listed explicitly — plus Event Orders, Courtside Brunch and Merchandise |

Below both lookups sits a short keyword layer, for the variants that cannot be
enumerated: outlets sell the same dessert by size or occasion — `Small Ice cream`,
`500gm Ice Cream`, `cake 500gm`, `CUSTOMER CAKE` — and the next weight is always
one order away. Booking words (`event`, `banquet`, `catering`) are checked first
and win, so `KG Birthday Cake event` is a booking rather than a dessert sale
while a plain `Birthday Cake` category stays a dessert. `scan-categories.mjs`
lists everything that matched this way so it can be promoted to an explicit
entry, where the decision is written down.

Two calls worth knowing about, both small and both easy to change: **Bakery**
(₹1,260 over three months) is treated as a dessert, following the decision that
put Cakes there; **Merchandise** and **Event Orders** stay in Other and in the
totals — they are real revenue but not part of the dessert/drinks question.

Editing the lists changes a fingerprint that invalidates the cached snapshots,
so a map edit takes effect on the next start and refetches the affected history
rather than appearing to do nothing.

Other is enumerated rather than left as a fallthrough on purpose: it makes
*unrecognised* mean "a category nobody has classified yet". A genuinely new name
shows on the page as an amber warning with its revenue, so a new dessert category
cannot quietly deflate the dessert share. If Other were a catch-all, that warning
would fire on all 33 savoury categories forever and the one case worth seeing
would be buried.

---

## The API this reads

`GET https://api.petpooja.com/V1/thirdparty/generic_get_orders/`, one call per
outlet per day. Three things about it are load-bearing:

- **It is a GET that carries a JSON body.** `fetch` refuses this outright
  (`Request with GET/HEAD method cannot have body`), so `petpooja.mjs` uses
  `node:https` directly. Do not "modernise" it to fetch.
- **A call for date D returns D and D−1.** Both are recorded, which halves the
  backfill and means every poll refreshes yesterday for free — late-night orders
  land against the previous business day after midnight.
- **It is live, not T−1.** The vendor documentation says otherwise; a call at
  20:17 returned an order billed at 20:10. History is real too, so weekly and
  monthly views are fetched, not accumulated forward.

It also sends no CORS headers, which is the other reason the browser talks only
to this server.

---

## Files

| | |
|---|---|
| `server.mjs` | HTTP server, JSON API, static allowlist |
| `store.mjs` | in-memory day aggregates, disk cache, backfill, 60s poll |
| `petpooja.mjs` | upstream client — `node:https`, retry, timeout |
| `aggregate.mjs` | orders → figures; the revenue and mix arithmetic |
| `periods.mjs` | day/week/month ranges and like-for-like comparison |
| `categories.mjs` | the dessert / drinks map |
| `outlets.mjs` | outlet registry |
| `public/` | the page |
| `data/` | cached day snapshots — gitignored, safe to delete |

## Checks

```sh
node --test *.test.mjs                        # 36 unit tests, no network
node --env-file=.env verify.mjs [YYYY-MM-DD]  # the same invariants, live
node scan-categories.mjs                      # map coverage over all cached history
```

`verify.mjs` asserts against real payloads that the mix exhausts menu sales, that
menu sales plus adjustments equal the till figure, that cancelled orders are
excluded, that the two-day window lands on the right days, and prints any
category not in the map.

`scan-categories.mjs` checks the map against every day on disk rather than one
day live — which is where renamed categories turn up, since a menu re-cut at one
outlet in July is invisible in today's payload but sits in three months of
totals. It exits non-zero if anything is unclassified.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | 4000 | |
| `POLL_MS` | 60000 | how often today is re-fetched, per outlet |
| `BACKFILL_MONTHS` | 2 | whole months of history beyond the current one |

## Known limits

- A day is compared against the day before. For a restaurant, the same weekday
  last week is often the more meaningful baseline — Monday against Sunday will
  always look like a collapse. The week and month views do not have this problem.
- `Ghaslet` is a category inside Capiche Ahmedabad 2.0, not an outlet — it is a
  sub-brand on that menu and currently counts as Other. Reporting it as its own
  brand line would need a category-level brand split.
- Purchase and Transfer APIs are enabled for all eighteen outlets and would give
  cost against these sales. Not built; `outlets.mjs` is shaped to allow it.

## How a category is classified

Three layers, most specific first. `node scan-categories.mjs` reports which one
fired for every name on disk.

| Layer | Catches | Example |
|---|---|---|
| **exact** | the name is listed in `categories.mjs` | `Drinks`, `Beverages`, `Cakes` |
| **loosened** | the same category under a menu re-cut | `New Drinks.`, `Desserts. [old]`, `11.Dips` |
| **keyword** | a size or occasion variant that cannot be enumerated | `500gm Ice Cream`, `CUSTOMER CAKE` |

An explicit entry always beats a heuristic, so anything the lower layers get
wrong is fixed by listing it. A name none of the three recognise still counts
toward the totals, as Other, and is flagged on the page.

The loosened layer is not a tidying detail: about a fifth of all revenue arrives
under a re-cut name, and `New Drinks.` is among the largest drinks categories in
the data. Without it, tens of lakhs of drinks and desserts sit in Other and both
headline shares read low.

---

## Deploying to Vercel

The dashboard runs two ways from one codebase.

| | Local | Vercel |
|---|---|---|
| Entry point | `server.mjs` | `api/*.mjs` |
| Store | `store.mjs` — disk, in-memory | `store-kv.mjs` — Upstash Redis |
| When it fetches | background poll, every 60s | inside the request |
| Cache | `data/` | KV, keyed by the category map version |

**Why it needed rebuilding.** Vercel suspends the container the moment a
response is sent, so the poll loop and backfill in `server.mjs` get frozen
mid-request. The first deployment recorded fetches taking 244 seconds against a
30-second timeout — not slow network, a process stopped and resumed much later.
`cachedDays: 0` confirmed nothing ever completed. So on Vercel all fetching
happens before the response is returned, and the cache lives in KV.

### One-time setup

1. In the Vercel project → **Storage** → add the **Upstash Redis / KV**
   integration. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically. The free tier is far more than the ~2.4 MB this needs.
2. In **Settings → Environment Variables**, add the four Petpooja values from
   your local `.env`: `PP_APP_KEY`, `PP_APP_SECRET`, `PP_ACCESS_TOKEN`,
   `PP_COOKIE`.
3. Redeploy.

`GET /api/health` reports whether both are wired up — it names what is missing
rather than failing silently.

### What to expect

Measured against live data, with concurrency 4:

| View | Cold (empty KV) | Warm |
|---|---|---|
| Day | 3.0s, 6 upstream calls | 3ms, 0 calls |
| Week | 11.2s, 42 calls | 6ms, 0 calls |
| Month | 12.3s, 48 calls | 7ms, 0 calls |

A closed day is fetched once, ever — it cannot change, so it is never refetched.
Only today expires, after 60 seconds. That is what makes the warm path free.

If a request runs out of its 45-second budget it returns what it has with
`truncated: true` and `complete: false`; the page says so and asks again, and
whatever was fetched is already cached. A partial, honest answer beats a
timeout.

### Note on access

There is no login. Anyone with the URL sees every outlet's live sales. That was
a deliberate decision; if it ever needs closing, the cheapest fix is Vercel's
built-in password protection on the project, which needs no code change.
