// Dashboard front end. One state object, one fetch, one render.

const state = {
  granularity: 'day',
  anchor: todayKey(),
  rolling: false,
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
  document.querySelectorAll('#granularity button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.g === state.granularity));
  });
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
  document.getElementById('headline').innerHTML = `
    <div class="tile">
      <div class="k">Total sales</div>
      <div class="v">${money(t.totalSales)}</div>
      <div class="d">${deltaHTML(t.salesDelta)} vs ${esc(period.prevLabel)}</div>
    </div>
    <div class="tile dessert">
      <div class="k">Desserts</div>
      <div class="v">${pct(t.dessertPct)}</div>
      <div class="d">${money(t.dessertSales)} · ${deltaHTML(t.dessertPctDelta, 'pp')}</div>
    </div>
    <div class="tile drink">
      <div class="k">Drinks</div>
      <div class="v">${pct(t.drinkPct)}</div>
      <div class="d">${money(t.drinkSales)} · ${deltaHTML(t.drinkPctDelta, 'pp')}</div>
    </div>
    <div class="tile">
      <div class="k">Orders</div>
      <div class="v">${inr.format(t.orders)}</div>
      <div class="d">${t.prevOrders ? `${inr.format(t.prevOrders)} previous` : '&nbsp;'}</div>
    </div>
    <div class="tile">
      <div class="k">Average order</div>
      <div class="v">${exact(t.aov)}</div>
      <div class="d">${deltaHTML(t.aovDelta)}</div>
    </div>`;
}

function renderBrands(brands) {
  document.getElementById('brands').innerHTML = brands
    .map(
      (b) => `
    <div class="card">
      <header>
        <h3>${esc(b.brand)}</h3>
        <span class="sub">${b.outlets} outlet${b.outlets === 1 ? '' : 's'}</span>
      </header>
      <div class="big">${money(b.totalSales)}</div>
      <div class="sub">${deltaHTML(b.salesDelta)} vs previous · ${inr.format(b.orders)} orders</div>
      <div class="mix">
        <span style="color:var(--dessert)">Desserts <b>${pct(b.dessertPct)}</b></span>
        <span style="color:var(--drink)">Drinks <b>${pct(b.drinkPct)}</b></span>
      </div>
      ${sparkline(trading(b.series).map((d) => d.totalSales), '#7d8cff')}
    </div>`,
    )
    .join('');
}

function renderRows(d) {
  const { key, dir } = state.sort;
  const rows = [...d.outlets].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * dir;
    const av = a[key];
    const bv = b[key];
    if (av == null) return 1; // absent values sort last whichever way the column runs
    if (bv == null) return -1;
    return (av - bv) * dir;
  });

  // Bars are scaled to the busiest outlet in the set, so the column reads as a
  // ranking. Scaling each to 100% would make every outlet look identical.
  const maxDessert = Math.max(...d.outlets.map((o) => o.dessertPct || 0), 1);
  const maxDrink = Math.max(...d.outlets.map((o) => o.drinkPct || 0), 1);
  const health = new Map(d.health.map((h) => [h.id, h]));

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    if (th.dataset.sort === key) th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  const shareCell = (value, max, cls, series, group, colour) => `
    <td><div class="share">
      ${microTrend(shareSeries(series, group), colour)}
      <div class="bar ${cls}"><i style="width:${((value || 0) / max) * 100}%"></i></div>
      <span class="pct">${pct(value)}</span>
    </div></td>`;

  document.getElementById('rows').innerHTML = rows
    .map((o) => {
      const err = health.get(o.id)?.lastError;
      const expanded = state.expanded === o.id;
      return `
      <tr class="outlet" data-id="${o.id}" aria-expanded="${expanded}">
        <td class="name">${esc(o.name)}
          <small>${esc(o.brand)}${err ? ` · <span class="err">${esc(err)}</span>` : ''}</small>
        </td>
        <td class="num">${money(o.totalSales)}</td>
        <td class="num">${deltaHTML(o.salesDelta)}</td>
        ${shareCell(o.dessertPct, maxDessert, 'dessert', o.series, 'desserts', '#d98cc4')}
        ${shareCell(o.drinkPct, maxDrink, 'drink', o.series, 'drinks', '#5cc8d8')}
        <td class="num">${inr.format(o.orders)}</td>
        <td class="num">${exact(o.aov)}</td>
      </tr>
      ${expanded ? renderDetail(o.id) : ''}`;
    })
    .join('');
}

function renderDetail(id) {
  const detail = state.details.get(id);
  if (!detail) return `<tr class="detail"><td colspan="7"><div class="detail-inner">Loading…</div></td></tr>`;
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
  return `<tr class="detail"><td colspan="7"><div class="detail-inner">
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

// ---- data ----------------------------------------------------------

const query = () =>
  new URLSearchParams({
    granularity: state.granularity,
    anchor: state.anchor,
    rolling: String(state.rolling),
  });

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
  reload();
});

document.getElementById('prev').addEventListener('click', () => step(-1));
document.getElementById('next').addEventListener('click', () => step(1));

document.getElementById('today').addEventListener('click', () => {
  state.anchor = todayKey();
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
