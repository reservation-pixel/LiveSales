// Dashboard front end. One state object, one fetch, one render.

const state = {
  // 'live' is a place to stand, not a period the API knows: it is the day view
  // pinned to today, and `query()` turns it back into one on the way out.
  granularity: 'live',
  anchor: todayKey(),
  // Custom mode only: anchor is the range start, `to` the end.
  to: null,
  // The month the calendar is showing, independent of what is selected.
  calMonth: null,
  // What the open picker is choosing: 'day', 'week' or 'month'. Set by the
  // button that opened it.
  pickerMode: 'day',
  // Month/year list open inside the picker.
  calDrop: false,
  search: '',
  sort: { key: 'totalSales', dir: -1 },
  expanded: null,
  data: null,
  details: new Map(),
};

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const isLive = () => state.granularity === 'live';

// ---- formatting ----------------------------------------------------
// Indian numerals: a wall display is read at a glance, and ₹28,41,203 is not.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

// False while the store has not read its cache. Every figure is unknown in that
// window, and printing ₹0 would assert something false — it reads as "no sales"
// when it means "nothing loaded".
let dataReady = true;

const count = (n) => (!dataReady || n == null ? '—' : inr.format(n));

const money = (n) => {
  if (!dataReady) return '—';
  if (n == null) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${inr.format(Math.round(n))}`;
};

const exact = (n) => (!dataReady || n == null ? '—' : `₹${inr.format(Math.round(n))}`);
const pct = (n) => (!dataReady || n == null ? '—' : `${n.toFixed(1)}%`);

// Set true while the comparison period is still loading. A delta against a
// half-loaded period is not approximately right, it is wrong — an uncached June
// makes July read as +2203% — so it is withheld rather than shown.
let comparable = true;

// A delta needs its sign and its direction to agree; null means there was no
// base period to compare against, which is not the same as no change.
const deltaHTML = (n, unit = '%') => {
  if (!comparable) return '<span class="flat" title="Comparison period still loading">—</span>';
  if (n == null) return '<span class="flat">—</span>';
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const sign = n > 0 ? '+' : '';
  const suffix = unit === 'pp' ? ' pp' : '%';
  return `<span class="${cls}">${sign}${n.toFixed(1)}${suffix}</span>`;
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- tiny charts ---------------------------------------------------

const sparkline = (values, colour, w = 260, h = 38) => {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return '';
  const max = Math.max(...pts, 1);
  const step = w / (pts.length - 1);
  const y = (v) => h - 2 - (v / max) * (h - 6);
  const line = pts.map((v, i) => `${i * step},${y(v)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${area}" fill="${colour}" opacity="0.13"></polygon>
    <polyline points="${line}" fill="none" stroke="${colour}" stroke-width="1.75"
      stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
};

const microTrend = (values, colour) => {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return '<span class="trend"></span>';
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  const step = 46 / (pts.length - 1);
  const line = pts.map((v, i) => `${i * step},${14 - ((v - min) / span) * 12}`).join(' ');
  return `<svg class="trend" viewBox="0 0 46 16" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${line}" fill="none" stroke="${colour}" stroke-width="1.5"
      stroke-linejoin="round" opacity="0.85"></polyline></svg>`;
};

// An hourly series spans midnight to midnight, but a restaurant trades for
// about half of that. Plotting the closed hours spends most of the chart width
// on a flat line at zero and squashes the service curve into the right-hand
// third. Trim to the hours that actually traded.
const trading = (series) => {
  const active = series.map((d) => d.totalSales > 0);
  const first = active.indexOf(true);
  if (first === -1) return series;
  return series.slice(first, active.lastIndexOf(true) + 1);
};

// ---- iconography ----------------------------------------------------

// Stroke icons, inline. Five tiles is not worth a font or a sprite sheet, and
// this page must keep working with no network at all.
const ICON = {
  sales: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="M3 12l9 4.5L21 12"/><path d="M3 16.5 12 21l9-4.5"/>',
  desserts: '<path d="M6 11h12l-1.2 8.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3L6 11Z"/><path d="M7.2 11a3 3 0 0 1 .5-4.6A3.2 3.2 0 0 1 12 3.7a3.2 3.2 0 0 1 4.3 2.7 3 3 0 0 1 .5 4.6"/>',
  drinks: '<path d="M6 7h12l-1.3 12.1a1.6 1.6 0 0 1-1.6 1.4H8.9a1.6 1.6 0 0 1-1.6-1.4L6 7Z"/><path d="M9.4 7 10.6 2.9M14.6 7 13.4 2.9"/>',
  orders: '<path d="M5 8h14l-1 12.2a1.5 1.5 0 0 1-1.5 1.3H7.5A1.5 1.5 0 0 1 6 20.2L5 8Z"/><path d="M9 10V6.6a3 3 0 0 1 6 0V10"/>',
  aov: '<circle cx="9" cy="9.5" r="3.2"/><path d="M3.6 19.5a5.6 5.6 0 0 1 10.8 0"/><path d="M15.8 6.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.3 14.9a5.6 5.6 0 0 1 3.1 4.6"/>',
};

const svgIcon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;

// One accent per tile, so the eye can find the same figure in the same colour
// every time. Desserts and drinks reuse the palette they own everywhere else.
const TONE = {
  sales: '#e0789f',
  dessert: '#d98cc4',
  drink: '#5cc8d8',
  orders: '#9d8cf0',
  aov: '#6f9df0',
};

// Brand identity colours. Two brands, so a map rather than a hash — a generated
// hue would be arbitrary where a deliberate one is not.
const BRAND_TONE = { Aiko: '#5fbf8f', Capiche: '#e2cfa4' };
const brandTone = (brand) => BRAND_TONE[brand] || '#7d8cff';

// The dessert/drink share of each bucket, so the sparkline in a share cell
// tracks the mix over time rather than repeating the revenue line.
const shareSeries = (series, group) =>
  trading(series).map((d) => {
    const menu = (d.groups.desserts || 0) + (d.groups.drinks || 0) + (d.groups.other || 0);
    return menu > 0 ? ((d.groups[group] || 0) / menu) * 100 : null;
  });

// ---- render --------------------------------------------------------

// Reads `state` alone, so it can run the instant a control is clicked rather
// than waiting for a response. On the deployment that wait is 2-13 seconds, and
// if the request fails it never arrives at all — which is why the buttons read
// as dead there while working fine locally.
function paintControls() {
  document.querySelectorAll('#granularity button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.g === state.granularity));
  });
}

function renderPeriodBar(d) {
  paintControls();

  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const failing = d.health.filter((h) => h.lastError);

  if (!dataReady) {
    dot.className = 'dot idle';
    status.textContent = 'Starting up — reading cache…';
  } else if (d.backfilling) {
    dot.className = 'dot idle';
    status.textContent = `Loading history… ${d.backfilling.done}/${d.backfilling.total}`;
  } else if (failing.length) {
    dot.className = 'dot bad';
    status.textContent = `${failing.length} outlet${failing.length === 1 ? '' : 's'} not responding`;
  } else if (d.period.live) {
    dot.className = 'dot live';
    status.textContent = `Live · updated ${new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    dot.className = 'dot idle';
    status.textContent = 'Closed period';
  }
}

function renderHeadline(t, period) {
  const s = trading(t.series || []);
  const of = (fn) => s.map(fn);

  const tiles = [
    {
      k: 'Total Sales', icon: 'sales', tone: 'sales',
      v: money(t.totalSales),
      d: `${deltaHTML(t.salesDelta)} <span class="vs">vs ${esc(period.prevLabel)}</span>`,
      series: of((x) => x.totalSales ?? 0),
    },
    {
      k: 'Desserts', icon: 'desserts', tone: 'dessert',
      v: pct(t.dessertPct),
      d: `${exact(t.dessertSales)} · ${deltaHTML(t.dessertPctDelta, 'pp')}`,
      series: of((x) => x.groups?.desserts ?? 0),
    },
    {
      k: 'Drinks', icon: 'drinks', tone: 'drink',
      v: pct(t.drinkPct),
      d: `${exact(t.drinkSales)} · ${deltaHTML(t.drinkPctDelta, 'pp')}`,
      series: of((x) => x.groups?.drinks ?? 0),
    },
    {
      k: 'Orders', icon: 'orders', tone: 'orders',
      v: count(t.orders),
      d: t.prevOrders
        ? `<span class="vs">${count(t.prevOrders)} previous</span>`
        : '<span class="vs">No orders yet</span>',
      series: of((x) => x.orders ?? 0),
    },
    {
      k: 'Average Order', icon: 'aov', tone: 'aov',
      v: exact(t.aov),
      d: t.aov == null ? '<span class="vs">No data yet</span>' : deltaHTML(t.aovDelta),
      // Deliberately no curve: an average per bucket is noisy on a quiet hour
      // and would read as volatility that is not there.
      series: [],
    },
  ];

  document.getElementById('headline').innerHTML = tiles
    .map(
      (tile) => `
    <div class="tile tone-${tile.tone}">
      <div class="tilehead">
        <span class="tileicon">${svgIcon(tile.icon)}</span>
        <span class="k">${tile.k}</span>
      </div>
      <div class="v">${tile.v}</div>
      <div class="d">${tile.d}</div>
      ${tile.series.length > 1 ? sparkline(tile.series, TONE[tile.tone], 260, 30) : ''}
    </div>`,
    )
    .join('');
}

function renderBrands(brands) {
  // Four figures across, each labelled and underscored in its own colour. The
  // percentages keep their money beside them: a share without the value behind
  // it cannot be compared between a two-outlet brand and a four-outlet one.
  const metric = (value, label, tone, sub) => `
    <div class="bmetric">
      <b>${value}</b>
      <span class="blabel" style="--rule:${tone}">${label}</span>
      ${sub ? `<span class="bsub">${sub}</span>` : ''}
    </div>`;

  document.getElementById('brands').innerHTML = brands
    .map((b) => {
      const tone = brandTone(b.brand);
      return `
    <div class="card brandcard">
      <header>
        <span class="avatar" style="--tone:${tone}">${esc(b.brand)}</span>
        <div class="btitle">
          <h3>${esc(b.brand)}</h3>
          <span class="sub">${b.outlets} outlet${b.outlets === 1 ? '' : 's'}</span>
        </div>
        ${sparkline(trading(b.series).map((d) => d.totalSales), tone, 260, 46)}
      </header>
      <div class="brandmetrics">
        ${metric(money(b.totalSales), 'Total Sales', TONE.sales)}
        ${metric(pct(b.dessertPct), 'Desserts', TONE.dessert, exact(b.dessertSales))}
        ${metric(pct(b.drinkPct), 'Drinks', TONE.drink, exact(b.drinkSales))}
        ${metric(count(b.orders), 'Orders', TONE.orders)}
        <div class="bmetric trailing">
          <b class="small">${deltaHTML(b.salesDelta)}</b>
          <span class="bsub">vs previous</span>
        </div>
      </div>
    </div>`;
    })
    .join('');
}

// Whether an outlet is actually reporting, from the fetch health the server
// already tracks. This is the one status worth showing: it separates "sold
// nothing" from "we could not ask", which look identical at ₹0.
function statusOf(health) {
  if (!health) return { label: 'Unknown', cls: 'unknown', note: '' };
  if (health.lastError) return { label: 'Offline', cls: 'offline', note: health.lastError };
  if (!health.lastSuccessAt) return { label: 'Waiting', cls: 'unknown', note: 'no response yet' };
  return { label: 'Online', cls: 'online', note: '' };
}

// Sorted and filtered, in one place, so the table and the CSV export can never
// disagree about what is on screen.
function visibleRows(d) {
  const { key, dir } = state.sort;
  const health = new Map(d.health.map((h) => [h.id, h]));
  const q = state.search.trim().toLowerCase();

  const rows = d.outlets.filter(
    (o) => !q || o.name.toLowerCase().includes(q) || o.brand.toLowerCase().includes(q),
  );

  return rows.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * dir;
    if (key === 'brand') return (a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)) * dir;
    if (key === 'status') {
      return statusOf(health.get(a.id)).label.localeCompare(statusOf(health.get(b.id)).label) * dir;
    }
    const av = a[key];
    const bv = b[key];
    if (av == null) return 1; // absent values sort last whichever way the column runs
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

function renderRows(d) {
  const { key, dir } = state.sort;
  const rows = visibleRows(d);

  // Bars are scaled to the busiest outlet in the set, so the column reads as a
  // ranking. Scaling each to 100% would make every outlet look identical.
  const maxDessert = Math.max(...d.outlets.map((o) => o.dessertPct || 0), 1);
  const maxDrink = Math.max(...d.outlets.map((o) => o.drinkPct || 0), 1);
  const health = new Map(d.health.map((h) => [h.id, h]));

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    if (th.dataset.sort === key) th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  // The share and the money it stands for. A percentage alone cannot be
  // compared across outlets of different sizes — 18% of Piplod is a fraction of
  // 8% of Capiche Ahmedabad.
  const shareCell = (value, sales, max, cls, series, group, colour) => `
    <td><div class="share">
      ${microTrend(shareSeries(series, group), colour)}
      <div class="bar ${cls}"><i style="width:${((value || 0) / max) * 100}%"></i></div>
      <span class="pct">${pct(value)}</span>
      <span class="shareval">${exact(sales)}</span>
    </div></td>`;

  const body = rows
    .map((o) => {
      const st = statusOf(health.get(o.id));
      const expanded = state.expanded === o.id;
      return `
      <tr class="outlet" data-id="${o.id}" aria-expanded="${expanded}">
        <td class="name">
          <span class="led ${st.cls}"></span>
          <span>${esc(o.name)}${st.note ? `<small class="err">${esc(st.note)}</small>` : ''}</span>
        </td>
        <td><span class="pill" style="--tone:${brandTone(o.brand)}">${esc(o.brand)}</span></td>
        <td class="num">${money(o.totalSales)}</td>
        <td class="num">${deltaHTML(o.salesDelta)}</td>
        ${shareCell(o.dessertPct, o.dessertSales, maxDessert, 'dessert', o.series, 'desserts', '#d98cc4')}
        ${shareCell(o.drinkPct, o.drinkSales, maxDrink, 'drink', o.series, 'drinks', '#5cc8d8')}
        <td class="num">${count(o.orders)}</td>
        <td class="num">${exact(o.aov)}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
      </tr>
      ${expanded ? renderDetail(o.id) : ''}`;
    })
    .join('');

  document.getElementById('rows').innerHTML =
    body ||
    `<tr><td colspan="9" class="empty">No outlet matches “${esc(state.search)}”.</td></tr>`;
}

function renderDetail(id) {
  const detail = state.details.get(id);
  if (!detail) return `<tr class="detail"><td colspan="9"><div class="detail-inner">Loading…</div></td></tr>`;
  const rows = detail.categories
    .map(
      (c) => `
    <div class="catrow">
      <span class="swatch sw-${c.group}"></span>
      <span class="cname">${esc(c.name)}</span>
      <span class="cval">${money(c.sales)}</span>
      <span class="cpct">${pct(c.share)}</span>
    </div>`,
    )
    .join('');
  return `<tr class="detail"><td colspan="9"><div class="detail-inner">
      <div class="sub" style="color:var(--ink-3);font-size:12px">
        ${esc(detail.period.label)} · menu sales ${exact(detail.menuSales)}
        ${detail.adjustments ? `· charges &amp; adjustments ${exact(detail.adjustments)}` : ''}
        · total ${exact(detail.totalSales)}
      </div>
      <div class="catgrid">${rows}</div>
    </div></td></tr>`;
}

function renderNotices(d) {
  const bits = [];

  if (d.unmapped.length) {
    const top = d.unmapped.slice(0, 8);
    bits.push(`<div class="notice warn">
      <b>${d.unmapped.length} categor${d.unmapped.length === 1 ? 'y is' : 'ies are'} not in the dessert/drinks map</b>
      — counted in Other. Add them to <span class="muted">categories.mjs</span> if any belong in a group.
      <ul>${top.map((u) => `<li>${esc(u.name)} — ${money(u.sales)}</li>`).join('')}
      ${d.unmapped.length > top.length ? `<li class="muted">and ${d.unmapped.length - top.length} more</li>` : ''}</ul>
    </div>`);
  }

  // Naming these matters: without the line, brand totals silently exclude a
  // third of the business and look like a decline.
  bits.push(`<div class="notice">
    <b>Not reporting</b> <span class="muted">— ${esc(d.notReportingReason)}.</span>
    <span class="muted">${d.notReporting.map((o) => esc(o.name)).join(' · ')}</span>
  </div>`);

  // Uncached deployment: a long period can exceed the request budget. Say why,
  // rather than leaving a short total looking like a bad trading month.
  if (d.truncated && d.cached === false) {
    bits.push(`<div class="notice warn">
      <b>Period too long to load in one request</b> — this deployment has no cache, so every
      figure is refetched. Daily and Weekly are fine; a full month needs an Upstash KV
      integration on the project. Showing ${d.period.days} day${d.period.days === 1 ? '' : 's'} fetched so far.
    </div>`);
  }

  if (!d.complete && !d.backfilling) {
    bits.push(`<div class="notice warn">Some days in this period are not loaded yet — figures may rise as history arrives.${
      d.truncated ? ' Still fetching; this refreshes itself.' : ''
    }</div>`);
  }
  if (!d.prevComplete) {
    bits.push(`<div class="notice warn">
      <b>Comparisons hidden</b> — ${esc(d.period.prevLabel)} is still loading, and a delta
      against a partly loaded period is wrong rather than approximate.
    </div>`);
  }

  document.getElementById('notices').innerHTML = bits.join('');
}

// ---- calendar --------------------------------------------------------
//
// Jump to any date, or in Custom mode pick a start and an end. Mon-first, to
// agree with weekStart() on the server — a Sunday-first grid would highlight a
// different week than Weekly actually selects.

const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n) => String(n).padStart(2, '0');
const dkey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDaysKey = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dkey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};
// Sunday = 0, for the grid's leading blanks. This is column layout only: the
// data layer's week is still Mon–Sun, and the highlight below is driven by the
// resolved period, so a Weekly selection wraps across two rows rather than
// pretending to be the Sun–Sat row it sits in.
const sunIndex = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOfWeek = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();

// "4 Aug". Abbreviated from the full month names already declared above rather
// than a second table that could drift out of step with the first.
const shortDate = (key) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${CAL_MONTHS[m - 1].slice(0, 3)}`;
};

let hoverDate = null;

// What the picker currently shows as chosen. Held here rather than written
// straight into `state`, so exploring dates costs nothing: on the deployment
// every applied change is a 2-13 second request.
let pending = null; // { from, to }

const calOpen = () => !document.getElementById('calendar').hidden;

function openCalendar(mode) {
  state.pickerMode = mode ?? state.pickerMode;
  state.calMonth = (state.anchor || todayKey()).slice(0, 7);
  hoverDate = null;
  // The month picker is a list, so it opens straight into it.
  state.calDrop = state.pickerMode === 'month';
  pending = state.data
    ? { from: state.data.period.from, to: state.data.period.to }
    : { from: state.anchor, to: state.anchor };
  document.getElementById('calendar').hidden = false;
  document.getElementById('calscrim').hidden = false;
  renderCalendar();
}

function closeCalendar() {
  document.getElementById('calendar').hidden = true;
  document.getElementById('calscrim').hidden = true;
  hoverDate = null;
  pending = null;
  state.calDrop = false;
}

// Which dates the current selection covers, so the grid can show the whole
// resolved period — picking 8 Sep with Monthly should light up all September
// before you commit to it.
function selectedSpan() {
  const p = state.data?.period;
  if (!p) return [state.anchor, state.anchor];
  return [p.from, p.to];
}

// Months that actually hold data. Anything outside has no figures behind it, so
// the dropdown must not offer it.
function availableMonths() {
  const a = state.data?.available;
  if (!a) return [];
  const out = [];
  let [y, m] = a.from.split('-').map(Number);
  const [ty, tm] = a.to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad2(m)}`);
    if (++m > 12) { m = 1; y += 1; }
  }
  return out;
}

// What the header band announces: the provisional pick if there is one, the
// applied period otherwise.
function pendingLabel() {
  const sel = pending ?? (state.data ? { from: state.data.period.from, to: state.data.period.to } : null);
  if (!sel) return '—';
  if (state.pickerMode === 'month') {
    const [my, mm] = sel.from.split('-').map(Number);
    return `${CAL_MONTHS[mm - 1]} ${my}`;
  }
  if (sel.from === sel.to) {
    const [y, m, d] = sel.from.split('-').map(Number);
    return `${DOW[dayOfWeek(y, m, d)]}, ${d} ${CAL_MONTHS[m - 1].slice(0, 3)}`;
  }
  return `${shortDate(sel.from)} – ${shortDate(sel.to)}`;
}

function renderCalendar() {
  const el = document.getElementById('calendar');
  const avail = state.data?.available;
  const [y, m] = state.calMonth.split('-').map(Number);
  const today = todayKey();

  // Shading comes from the real selection, never from the row it lands in.
  const sel = pending ?? (state.data ? { from: state.data.period.from, to: state.data.period.to } : null);
  const spanFrom = sel?.from ?? '';
  const spanTo = sel?.to ?? '';

  const cells = [];
  for (let i = 0; i < sunIndex(y, m, 1); i += 1) cells.push('<span class="cday blank"></span>');

  for (let d = 1; d <= daysInMonth(y, m); d += 1) {
    const key = dkey(y, m, d);
    const usable = key <= today && (!avail || (key >= avail.from && key <= avail.to));
    const inSpan = spanFrom && key >= spanFrom && key <= spanTo;
    const cls = ['cday', usable ? 'usable' : 'off', inSpan ? 'in' : '',
      key === spanFrom ? 'start' : '', key === spanTo ? 'end' : '',
      key === today ? 'today' : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${cls}" data-date="${key}" ${usable ? '' : 'disabled'}
                        aria-pressed="${Boolean(inSpan)}">${d}</button>`);
  }

  const months = availableMonths();
  const idx = months.indexOf(state.calMonth);
  const hint = { day: 'Pick a day', week: 'Pick any day in the week', month: 'Pick a month' }[state.pickerMode] ?? '';

  el.innerHTML = `
    <div class="calband">
      <div class="calyear">${y}</div>
      <div class="calsel">${esc(pendingLabel())}</div>
    </div>
    <div class="calbody">
      <div class="calhead">
        ${state.pickerMode === 'month'
          ? `<strong class="calmonth-static">Choose a month</strong>`
          : `<button class="calmonth" data-drop="1" aria-expanded="${state.calDrop ? 'true' : 'false'}">
               ${CAL_MONTHS[m - 1]} ${y} <span class="caret">▾</span>
             </button>`}
        <div class="calsteps" ${state.pickerMode === 'month' ? 'hidden' : ''}>
          <button class="calnav" data-mstep="-1" ${idx > 0 ? '' : 'disabled'} aria-label="Previous month">‹</button>
          <button class="calnav" data-mstep="1" ${idx >= 0 && idx < months.length - 1 ? '' : 'disabled'} aria-label="Next month">›</button>
        </div>
      </div>
      ${state.calDrop
        ? `<div class="calmonths">${months.map((k) => {
            const [my, mm] = k.split('-').map(Number);
            return `<button data-month="${k}" aria-pressed="${k === state.calMonth}">${CAL_MONTHS[mm - 1]} ${my}</button>`;
          }).join('')}</div>`
        : `<div class="caldow">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((x) => `<span>${x}</span>`).join('')}</div>
           <div class="calgrid">${cells.join('')}</div>`}
    </div>
    <div class="calfoot">
      <span class="calhint">${esc(hint)}</span>
      <div class="calactions">
        <button data-act="cancel">CANCEL</button>
        <button data-act="ok" class="ok">OK</button>
      </div>
    </div>`;
}

function pickDate(key) {
  if (state.pickerMode === 'week') {
    // Show the whole week the day belongs to, so what is highlighted is what
    // will be fetched. Mon-Sun, matching the data layer — in a Sunday-first
    // grid that span wraps two rows, which is the honest rendering.
    const [y, m, d] = key.split('-').map(Number);
    const back = (dayOfWeek(y, m, d) + 6) % 7;
    const from = addDaysKey(key, -back);
    pending = { from, to: addDaysKey(from, 6) };
  } else {
    pending = { from: key, to: key };
  }
  renderCalendar();
}

// Nothing reaches `state` — and nothing is fetched — until here.
function commitCalendar() {
  if (!pending) return closeCalendar();
  // The granularity comes from the button that opened the picker, so choosing
  // in it is the whole interaction — there is nothing else to set afterwards.
  state.granularity = state.pickerMode;
  state.anchor = pending.from;
  state.to = null;
  closeCalendar();
  reload();
}

// ---- data ----------------------------------------------------------

const query = () => {
  // Re-snapping the anchor here, rather than when the tab was clicked, is what
  // carries a page left open overnight onto the new day instead of freezing it
  // on yesterday while still calling itself live.
  if (isLive()) state.anchor = todayKey();
  const q = new URLSearchParams({
    granularity: isLive() ? 'day' : state.granularity,
    anchor: state.anchor,
  });
  return q;
};

// Clicking twice quickly starts two requests. At 10s each on the deployment the
// slower one can land second and overwrite the newer selection, so every
// response carries the id of the request that asked for it and stale ones are
// dropped.
let requestId = 0;

const setPending = (on) => document.getElementById('appbar').classList.toggle('loading', on);

async function load() {
  const mine = ++requestId;
  setPending(true);
  try {
    // Two phases. The first skips the comparison period, halving the upstream
    // work, so figures appear roughly twice as fast; deltas are withheld and
    // the page says so. The second fills them in, and by then the current
    // period is already cached so it only costs the comparison.
    const first = await fetch(`/api/summary?${query()}&phase=current`);
    const data = await first.json();
    if (mine !== requestId) return; // a newer click has already superseded this
    if (!first.ok) throw new Error(data.error || first.statusText);
    state.data = data;
    render();

    const full = await fetch(`/api/summary?${query()}`);
    if (mine !== requestId) return;
    const withDeltas = await full.json();
    if (full.ok) {
      state.data = withDeltas;
      render();
    }
  } catch (err) {
    if (mine !== requestId) return;
    // The bar has room for a few words; a configuration error needs a sentence.
    // Short form in the status, full text in the page where it can be read.
    const st = document.getElementById('status');
    st.textContent = 'Cannot load data';
    st.title = err.message;
    document.getElementById('dot').className = 'dot bad';
    document.getElementById('notices').innerHTML =
      `<div class="notice warn"><b>Could not load data</b> — ${esc(err.message)}</div>`;
    document.getElementById('pagesub').textContent = 'Not loaded';
  } finally {
    if (mine === requestId) setPending(false);
  }
}

async function loadDetail(id) {
  const res = await fetch(`/api/outlet/${id}?${query()}`);
  if (!res.ok) return;
  state.details.set(id, await res.json());
  render();
}

function render() {
  const d = state.data;
  if (!d) return;
  dataReady = d.ready !== false;
  comparable = dataReady && d.prevComplete !== false;
  renderPeriodBar(d);
  renderHeadline(d.total, d.period);
  renderBrands(d.brands);
  renderRows(d);
  renderNotices(d);
  renderPageHead(d);
  renderHeaderTotals(d.total);
}

// The bar's copy of the headline figures, for once the stat cards have scrolled
// away. Reads the same `total` object renderHeadline does — recomputing here
// would let the bar and the tiles drift apart without anything failing.
function renderHeaderTotals(t) {
  document.getElementById('header-totals').innerHTML = `
    <span class="t-money">${money(t.totalSales)}</span>
    <span class="t-mix">
      <span class="d">Desserts <b>${pct(t.dessertPct)}</b></span>
      &nbsp;·&nbsp;
      <span class="k">Drinks <b>${pct(t.drinkPct)}</b></span>
    </span>`;
}

// Context line under the title: what period is on screen and how much of the
// estate is behind it. The reference put a personal greeting here; there is no
// login, so it says what the page is instead of who it thinks you are.
function renderPageHead(d) {
  // Reporting means it has actually answered, not merely that it has not
  // errored yet — before the first poll those are not the same claim.
  const reporting = d.health.filter((h) => h.lastSuccessAt && !h.lastError).length;
  // The comparison range used to sit under the date in the header. The header
  // no longer carries a date, but this sentence still has to appear somewhere:
  // it is what stops a part-traded period, measured against an equally
  // part-traded one, from reading as a collapse.
  const p = d.period;
  const trimmed =
    p.comparedToHour != null
      ? ` to ${String(p.comparedToHour).padStart(2, '0')}:00`
      : p.open
        ? ` (${p.days} day${p.days === 1 ? '' : 's'} so far)`
        : '';

  const bits = [
    isLive() ? `Live · ${p.label}` : p.label,
    `vs ${p.prevLabel}${trimmed}`,
    `${reporting} of ${d.health.length} outlets reporting`,
    `${d.notReporting.length} without Orders API`,
  ];
  document.getElementById('pagesub').textContent = bits.join(' · ');
}

// CSV of exactly what is on screen — same sort, same search filter. An export
// that quietly differs from the table is worse than no export.
function exportCSV() {
  const d = state.data;
  if (!d) return;
  const health = new Map(d.health.map((h) => [h.id, h]));
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    'Outlet', 'Brand', 'Sales (gross incl GST)', 'vs prev %',
    'Desserts %', 'Desserts', 'Drinks %', 'Drinks',
    'Orders', 'Average order', 'Status',
  ];
  const lines = visibleRows(d).map((o) =>
    [
      o.name, o.brand, o.totalSales, o.salesDelta,
      o.dessertPct, o.dessertSales, o.drinkPct, o.drinkSales,
      o.orders, o.aov, statusOf(health.get(o.id)).label,
    ].map(cell).join(','),
  );

  const csv = [
    `# Bookends Hospitality — ${d.period.label}`,
    `# vs ${d.period.prevLabel}`,
    head.join(','),
    ...lines,
  ].join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookends-sales-${d.period.from}-to-${d.period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- interaction ---------------------------------------------------

// Changing the period invalidates every open detail panel; they are keyed by
// outlet, not by outlet+period, so stale ones would show the wrong month.
function reload() {
  state.details.clear();
  // Paint the selection immediately. Everything below waits on the network;
  // this does not, and it is the difference between a button that responds and
  // one that appears broken for ten seconds.
  paintControls();
  load().then(() => state.expanded && loadDetail(state.expanded));
}

function step(direction) {
  // Live is pinned to now. Stepping off it would leave the tab asserting
  // something the figures underneath no longer say.
  if (isLive()) return;
  const [y, m, day] = state.anchor.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, day, 12));

  if (state.granularity === 'day') {
    at.setUTCDate(at.getUTCDate() + direction);
  } else if (state.granularity === 'week') {
    at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7) + 7 * direction);
  } else {
    at.setUTCMonth(at.getUTCMonth() + direction, 1);
  }
  const p = (n) => String(n).padStart(2, '0');
  const next = `${at.getUTCFullYear()}-${p(at.getUTCMonth() + 1)}-${p(at.getUTCDate())}`;
  if (next > todayKey()) return;
  state.anchor = next;
  reload();
}

document.getElementById('granularity').addEventListener('click', (e) => {
  const g = e.target.closest('button')?.dataset.g;
  if (!g) return;

  // Live has nothing to ask: it means now. Everything else opens the picker for
  // its own granularity — including when it is already the active one, which is
  // exactly when you want to change the date.
  if (g === 'live') {
    state.granularity = 'live';
    state.to = null;
    closeCalendar();
    reload();
    return;
  }

  state.to = null;
  openCalendar(g);
});

document.querySelector('thead').addEventListener('click', (e) => {
  const key = e.target.closest('th')?.dataset.sort;
  if (!key) return;
  // Second click on the same column reverses it; a new column starts descending
  // except for the name, where A–Z is the expected first press.
  state.sort =
    state.sort.key === key
      ? { key, dir: -state.sort.dir }
      : { key, dir: key === 'name' ? 1 : -1 };
  render();
});

// Filtering is local to data already loaded, so it re-renders rather than
// refetching — typing must not put six requests per keystroke on the API.
// Swap the bar's slot from tagline to totals once the stat cards leave the
// viewport. An IntersectionObserver fires twice per page traversal; a scroll
// listener would fire on every frame to answer the same question.
const sentinel = document.getElementById('scroll-sentinel');
if (sentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => document.getElementById('appbar').classList.toggle('scrolled', !entry.isIntersecting),
    { rootMargin: '-8px 0px 0px 0px' },
  ).observe(sentinel);
}

document.getElementById('calendar').addEventListener('click', (e) => {
  const mstep = e.target.closest('[data-mstep]')?.dataset.mstep;
  if (mstep) {
    const months = availableMonths();
    const next = months[months.indexOf(state.calMonth) + Number(mstep)];
    if (next) {
      state.calMonth = next;
      renderCalendar();
    }
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) {
    if (act === 'ok') commitCalendar();
    else closeCalendar();
    return;
  }

  if (e.target.closest('[data-drop]')) {
    state.calDrop = !state.calDrop;
    renderCalendar();
    return;
  }

  const month = e.target.closest('[data-month]')?.dataset.month;
  if (month) {
    state.calMonth = month;
    if (state.pickerMode === 'month') {
      // Provisional, exactly like the day and week grids. Committing on tap
      // meant the picker applied and vanished without OK ever being pressed —
      // from the outside that is indistinguishable from it closing itself.
      const [my, mm] = month.split('-').map(Number);
      pending = { from: `${month}-01`, to: dkey(my, mm, daysInMonth(my, mm)) };
      renderCalendar();
      return;
    }
    state.calDrop = false;
    renderCalendar();
    return;
  }

  const date = e.target.closest('.cday.usable')?.dataset.date;
  if (date) pickDate(date);
});

// The picker is modal, like the Material dialog it is modelled on: a scrim
// covers the page and CANCEL, OK or Escape are the only ways out. Dismissing on
// any click landing outside the 284px popover threw the selection away on a
// stray tap — from the user's side, the picker closing on its own.
document.addEventListener('keydown', (e) => {
  if (!calOpen()) return;
  // Escape discards the provisional pick; Enter is the same as OK.
  if (e.key === 'Escape') closeCalendar();
  if (e.key === 'Enter') commitCalendar();
});

document.getElementById('search').addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});

document.getElementById('export').addEventListener('click', exportCSV);

document.getElementById('rows').addEventListener('click', (e) => {
  const id = e.target.closest('tr.outlet')?.dataset.id;
  if (!id) return;
  if (state.expanded === id) {
    state.expanded = null;
    render();
    return;
  }
  state.expanded = id;
  render();
  if (!state.details.has(id)) loadDetail(id);
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

load();
// Only the live view needs refreshing; a closed period cannot change, and a
// number that appears to update invites doubt about whether it settled.
setInterval(() => {
  const d = state.data;
  if (!d) return;
  // `truncated` is the serverless deployment saying it ran out of time with
  // days still missing. It has cached whatever it did fetch, so asking again
  // is cheap and finishes the job.
  if (isLive() || d.period.live || d.backfilling || d.truncated || d.complete === false) reload();
}, 30_000);
