// Dashboard front end. One state object, one fetch, one render.

const state = {
  granularity: 'day',
  anchor: todayKey(),
  rolling: false,
  // Custom mode only: anchor is the range start, `to` the end.
  to: null,
  // The month the calendar is showing, independent of what is selected.
  calMonth: null,
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

// ---- formatting ----------------------------------------------------
// Indian numerals: a wall display is read at a glance, and ₹28,41,203 is not.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const money = (n) => {
  if (n == null) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${inr.format(Math.round(n))}`;
};

const exact = (n) => (n == null ? '—' : `₹${inr.format(Math.round(n))}`);
const pct = (n) => (n == null ? '—' : `${n.toFixed(1)}%`);

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

function renderPeriodBar(d) {
  const p = d.period;
  // Relabel Week/Month while rolling is on. The toggle is an unlabelled icon,
  // so the mode is shown where it actually applies rather than left to be
  // inferred from a pressed state. Day is genuinely unaffected by rolling —
  // resolve() returns before the rolling branch — so it keeps its label.
  const ROLLING_LABEL = { day: 'Daily', week: '7 days', month: '30 days', custom: 'Custom' };
  const CALENDAR_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly', custom: 'Custom' };
  const labels = state.rolling ? ROLLING_LABEL : CALENDAR_LABEL;

  document.querySelectorAll('#granularity button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.g === state.granularity));
    // Text only. data-g is what the click handler reads and must not change.
    b.textContent = labels[b.dataset.g] ?? b.textContent;
  });

  // Rolling only means something for Weekly and Monthly. It was previously
  // clickable in Daily and silently did nothing, which is worse than being
  // visibly unavailable.
  const rollingApplies = state.granularity === 'week' || state.granularity === 'month';
  const rollingBtn = document.getElementById('rolling');
  rollingBtn.disabled = !rollingApplies;
  rollingBtn.title = rollingApplies
    ? 'Rolling: use the last 7 / 30 days instead of calendar weeks and months'
    : 'Rolling applies to Weekly and Monthly only';
  document.getElementById('rolling').setAttribute('aria-pressed', String(state.rolling));
  document.getElementById('range-label').textContent = p.label;
  // Always name the comparison range. A partial month set against a partial
  // previous month is only trustworthy if you can see which days it used.
  // Name the comparison range, and say when it was cut short to match. A
  // part-traded day set against a whole one is only trustworthy if the reader
  // can see that both sides stop at the same point.
  const trimmed =
    p.comparedToHour != null
      ? ` to ${String(p.comparedToHour).padStart(2, '0')}:00`
      : p.open
        ? ` · ${p.days} day${p.days === 1 ? '' : 's'} so far`
        : '';
  document.getElementById('prev-label').textContent = `vs ${p.prevLabel}${trimmed}`;
  document.getElementById('next').disabled = p.to >= todayKey();

  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const failing = d.health.filter((h) => h.lastError);

  if (d.backfilling) {
    dot.className = 'dot idle';
    status.textContent = `Loading history… ${d.backfilling.done}/${d.backfilling.total}`;
  } else if (failing.length) {
    dot.className = 'dot bad';
    status.textContent = `${failing.length} outlet${failing.length === 1 ? '' : 's'} not responding`;
  } else if (p.live) {
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
      v: inr.format(t.orders),
      d: t.prevOrders
        ? `<span class="vs">${inr.format(t.prevOrders)} previous</span>`
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
        ${metric(inr.format(b.orders), 'Orders', TONE.orders)}
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
        <td class="num">${inr.format(o.orders)}</td>
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

  if (!d.complete && !d.backfilling) {
    bits.push(`<div class="notice warn">Some days in this period are not loaded yet — figures may rise as history arrives.</div>`);
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
// Mon = 0 … Sun = 6, matching the server's week start.
const monIndex = (y, m, d) => (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;

// Half-finished range: the first click in Custom mode, before the second.
let pendingStart = null;
let hoverDate = null;

const calOpen = () => !document.getElementById('calendar').hidden;

function openCalendar() {
  state.calMonth = (state.anchor || todayKey()).slice(0, 7);
  pendingStart = null;
  hoverDate = null;
  document.getElementById('calendar').hidden = false;
  document.getElementById('datebtn').setAttribute('aria-expanded', 'true');
  renderCalendar();
}

function closeCalendar() {
  document.getElementById('calendar').hidden = true;
  document.getElementById('datebtn').setAttribute('aria-expanded', 'false');
  pendingStart = null;
  hoverDate = null;
}

// Which dates the current selection covers, so the grid can show the whole
// resolved period — picking 8 Sep with Monthly should light up all September
// before you commit to it.
function selectedSpan() {
  if (pendingStart) {
    const end = hoverDate && hoverDate >= pendingStart ? hoverDate : pendingStart;
    const start = hoverDate && hoverDate < pendingStart ? hoverDate : pendingStart;
    return [start, end];
  }
  const p = state.data?.period;
  if (!p) return [state.anchor, state.anchor];
  return [p.from, p.to];
}

function renderCalendar() {
  const el = document.getElementById('calendar');
  const avail = state.data?.available;
  const [y, m] = state.calMonth.split('-').map(Number);
  const [spanFrom, spanTo] = selectedSpan();
  const today = todayKey();

  const lead = monIndex(y, m, 1);
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push('<span class="cday blank"></span>');

  for (let d = 1; d <= daysInMonth(y, m); d += 1) {
    const key = dkey(y, m, d);
    const usable = key <= today && (!avail || (key >= avail.from && key <= avail.to));
    const inSpan = key >= spanFrom && key <= spanTo;
    const cls = [
      'cday',
      usable ? 'usable' : 'off',
      inSpan ? 'in' : '',
      key === spanFrom ? 'start' : '',
      key === spanTo ? 'end' : '',
      key === today ? 'today' : '',
    ].filter(Boolean).join(' ');
    cells.push(
      `<button class="${cls}" data-date="${key}" ${usable ? '' : 'disabled'}
               aria-pressed="${inSpan}">${d}</button>`,
    );
  }

  // Only a month with usable days is worth stepping to.
  const prevMonth = dkey(y, m, 1) > (avail?.from ?? '0000-01-01');
  const nextMonth = dkey(y, m, daysInMonth(y, m)) < today;

  const foot =
    state.granularity === 'custom'
      ? pendingStart
        ? `Start ${shortDate(pendingStart)} — now pick the end`
        : 'Pick a start date, then an end'
      : `${state.data?.period.label ?? ''}`;

  el.innerHTML = `
    <div class="calhead">
      <button class="calnav" data-mstep="-1" ${prevMonth ? '' : 'disabled'} aria-label="Previous month">‹</button>
      <strong>${CAL_MONTHS[m - 1]} ${y}</strong>
      <button class="calnav" data-mstep="1" ${nextMonth ? '' : 'disabled'} aria-label="Next month">›</button>
    </div>
    <div class="caldow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="calgrid">${cells.join('')}</div>
    <div class="calfoot">${esc(foot)}</div>`;
}

const shortDate = (key) => {
  const [, m, d] = key.split('-').map(Number);
  // Abbreviated from the full names already declared above, rather than a
  // second month table that could drift out of step with the first.
  return `${d} ${CAL_MONTHS[m - 1].slice(0, 3)}`;
};

function pickDate(key) {
  if (state.granularity !== 'custom') {
    state.anchor = key;
    closeCalendar();
    reload();
    return;
  }
  if (!pendingStart) {
    // First click. Nothing is applied yet — a range needs both ends.
    pendingStart = key;
    hoverDate = null;
    renderCalendar();
    return;
  }
  // Second click. Clicking earlier than the start means the user is choosing
  // the other end, not making a mistake, so swap rather than refuse.
  const [from, to] = key < pendingStart ? [key, pendingStart] : [pendingStart, key];
  state.anchor = from;
  state.to = to;
  closeCalendar();
  reload();
}

// ---- data ----------------------------------------------------------

const query = () => {
  const q = new URLSearchParams({
    granularity: state.granularity,
    anchor: state.anchor,
    rolling: String(state.rolling),
  });
  if (state.granularity === 'custom') q.set('to', state.to ?? state.anchor);
  return q;
};

async function load() {
  try {
    const res = await fetch(`/api/summary?${query()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.data = data;
    render();
  } catch (err) {
    document.getElementById('status').textContent = `Error: ${err.message}`;
    document.getElementById('dot').className = 'dot bad';
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
  comparable = d.prevComplete !== false;
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
  const reporting = d.health.filter((h) => !h.lastError).length;
  const bits = [
    d.period.label,
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
  load().then(() => state.expanded && loadDetail(state.expanded));
}

function step(direction) {
  const [y, m, day] = state.anchor.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, day, 12));

  // A custom range has no calendar unit to step by, so it moves by its own
  // span and carries its end along with it.
  if (state.granularity === 'custom') {
    const span = state.data?.period ? state.data.period.days : 1;
    const p = (n) => String(n).padStart(2, '0');
    const shift = (key, n) => {
      const [yy, mm, dd] = key.split('-').map(Number);
      const s2 = new Date(Date.UTC(yy, mm - 1, dd + n, 12));
      return `${s2.getUTCFullYear()}-${p(s2.getUTCMonth() + 1)}-${p(s2.getUTCDate())}`;
    };
    const nextFrom = shift(state.anchor, direction * span);
    const nextTo = shift(state.to ?? state.anchor, direction * span);
    if (nextTo > todayKey()) return;
    state.anchor = nextFrom;
    state.to = nextTo;
    reload();
    return;
  }

  if (state.granularity === 'day' || state.rolling) {
    at.setUTCDate(at.getUTCDate() + direction * (state.granularity === 'day' ? 1 : state.granularity === 'week' ? 7 : 30));
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
  if (!g || g === state.granularity) return;
  state.granularity = g;

  if (g === 'custom') {
    // Seed from whatever was on screen, so switching to Custom shows the same
    // figures rather than resetting the page to a single day.
    const p = state.data?.period;
    state.anchor = p?.from ?? state.anchor;
    state.to = p?.to ?? state.anchor;
    openCalendar();
    return; // the calendar applies the range; nothing to fetch yet
  }
  state.to = null;
  reload();
});

document.getElementById('prev').addEventListener('click', () => step(-1));
document.getElementById('next').addEventListener('click', () => step(1));

document.getElementById('today').addEventListener('click', () => {
  state.anchor = todayKey();
  // In Custom mode "Today" means today, a single day — keeping the old end
  // would silently produce a range nobody asked for.
  if (state.granularity === 'custom') state.to = todayKey();
  reload();
});

document.getElementById('rolling').addEventListener('click', () => {
  state.rolling = !state.rolling;
  reload();
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

document.getElementById('datebtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (calOpen()) closeCalendar();
  else openCalendar();
});

document.getElementById('calendar').addEventListener('click', (e) => {
  e.stopPropagation();
  const mstep = e.target.closest('[data-mstep]')?.dataset.mstep;
  if (mstep) {
    const [y, m] = state.calMonth.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + Number(mstep), 1, 12));
    state.calMonth = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
    renderCalendar();
    return;
  }
  const date = e.target.closest('.cday.usable')?.dataset.date;
  if (date) pickDate(date);
});

// Previewing the span while choosing the second end is what makes a two-click
// range legible; without it you are picking blind.
document.getElementById('calendar').addEventListener('mouseover', (e) => {
  if (!pendingStart) return;
  const date = e.target.closest('.cday.usable')?.dataset.date;
  if (date && date !== hoverDate) {
    hoverDate = date;
    renderCalendar();
  }
});

document.addEventListener('click', () => { if (calOpen()) closeCalendar(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && calOpen()) closeCalendar();
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
  if (state.data?.period.live || state.data?.backfilling) reload();
}, 30_000);
