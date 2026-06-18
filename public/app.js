/* ═══════════════════════════════════════════════════════════
   Mahakali Jewellers – client-side live-rate app
   ═══════════════════════════════════════════════════════════ */

const socket = io({ transports: ['websocket', 'polling'] });

/* ── State ──────────────────────────────────────────────── */
const state = {
  data: null,
  currentPage: 'gold',
  coinTab: 'gold',
  renderTimer: null,
  lastRender: 0,
  prev: {
    goldKarat:    new Map(),
    goldProducts: new Map(),
    goldFuture:   new Map(),
    goldSpot:     new Map(),
    silverProducts: new Map(),
    silverFuture: new Map(),
    silverSpot:   new Map(),
    coinGold:     new Map(),
    coinSilver:   new Map(),
  },
};

/* ── Element refs ───────────────────────────────────────── */
const el = {
  statusDot:          document.getElementById('statusDot'),
  statusText:         document.getElementById('statusText'),
  lastUpdated:        document.getElementById('lastUpdated'),
  goldKaratGrid:      document.getElementById('goldKaratGrid'),
  goldProductTable:   document.getElementById('goldProductTable'),
  goldFutureTable:    document.getElementById('goldFutureTable'),
  goldSpotTable:      document.getElementById('goldSpotTable'),
  silverProductTable: document.getElementById('silverProductTable'),
  silverFutureTable:  document.getElementById('silverFutureTable'),
  silverSpotTable:    document.getElementById('silverSpotTable'),
  coinTable:          document.getElementById('coinTable'),
  coinTabGold:        document.getElementById('coinTabGold'),
  coinTabSilver:      document.getElementById('coinTabSilver'),
  navItems:           Array.from(document.querySelectorAll('.nav-item')),
  pages:              Array.from(document.querySelectorAll('.page')),
};

/* ── Throttle: render max once per 1 s ──────────────────── */
function scheduleRender(data) {
  state.data = data;
  if (state.renderTimer) return;
  const wait = Math.max(0, 1000 - (Date.now() - state.lastRender));
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    state.lastRender = Date.now();
    renderAll(state.data);
  }, wait);
}

/* ── Helpers ────────────────────────────────────────────── */
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function fmt(v) {
  const n = num(v);
  return n == null ? '—' : n.toLocaleString('en-IN');
}
function timeFmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function setText(node, v) {
  if (!node) return;
  const s = String(v ?? '—');
  if (node.textContent !== s) node.textContent = s;
}
function dir(cur, prv) {
  const c = num(cur), p = num(prv);
  if (c == null || p == null || c === p) return '';
  return c > p ? 'up' : 'down';
}
// Patch a numeric cell: update text + up/down class only if changed
function patchNum(cell, val, prevVal) {
  if (!cell) return;
  const text = fmt(val);
  if (cell.textContent !== text) cell.textContent = text;
  const d = dir(val, prevVal);
  const wasUp = cell.classList.contains('up');
  const wasDown = cell.classList.contains('down');
  if (wasUp !== (d === 'up'))   cell.classList.toggle('up',   d === 'up');
  if (wasDown !== (d === 'down')) cell.classList.toggle('down', d === 'down');
}
function rowKey(item) {
  return String(item?.name || item?.label || item?.key || '').trim().toLowerCase();
}

/* ── Product table rows (BID / ASK / HIGH / LOW) ───────── */
function createProductRow(key) {
  const r = document.createElement('div');
  r.className = 'rate-row';
  r.dataset.key = key;
  r.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num bid"></div>
    <div class="rate-cell rate-num ask"></div>
    <div class="rate-cell rate-num high"></div>
    <div class="rate-cell rate-num low"></div>`;
  return r;
}

/* Render rows inside a container that already has a .rate-row.header.
   Only creates/removes rows when the set changes; otherwise patches in-place. */
function renderProductRows(container, items, cache) {
  if (!items || !items.length) return;

  const keys = items.map(rowKey);

  // Build map of existing data rows
  const existing = new Map(
    Array.from(container.querySelectorAll('.rate-row:not(.header)')).map(r => [r.dataset.key, r])
  );

  // Check if structure changed
  const curKeys = Array.from(container.querySelectorAll('.rate-row:not(.header)')).map(r => r.dataset.key);
  const changed = curKeys.length !== keys.length || keys.some((k, i) => k !== curKeys[i]);

  if (changed) {
    const header = container.querySelector('.rate-row.header');
    const rows = keys.map(k => existing.get(k) || createProductRow(k));
    // Remove all non-header children then re-append
    Array.from(container.children).forEach(c => { if (!c.classList.contains('header')) c.remove(); });
    rows.forEach(r => container.appendChild(r));
  }

  // Patch values in-place
  items.forEach(item => {
    const key = rowKey(item);
    const row = container.querySelector(`.rate-row[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    const prev = cache.get(key) || {};

    setText(row.querySelector('.rate-name'), item.name || key);
    patchNum(row.querySelector('.bid'),  item.bid  ?? item.buy,  prev.bid);
    patchNum(row.querySelector('.ask'),  item.ask  ?? item.sell, prev.ask);
    patchNum(row.querySelector('.high'), item.high,              prev.high);
    patchNum(row.querySelector('.low'),  item.low,               prev.low);

    cache.set(key, { bid: item.bid ?? item.buy, ask: item.ask ?? item.sell, high: item.high, low: item.low });
  });
}

/* ── Mini series table (Future / Spot): NAME | PRICE | H/L ─ */
function ensureMiniTable(container) {
  let w = container.querySelector('.mini-table');
  if (!w) {
    w = document.createElement('div');
    w.className = 'mini-table rate-table';
    w.innerHTML = `<div class="rate-row header mini-hdr">
      <div class="rate-cell rate-name">NAME</div>
      <div class="rate-cell rate-num">PRICE</div>
      <div class="rate-cell rate-num" style="font-size:.78rem">H / L</div>
    </div>`;
    container.innerHTML = '';
    container.appendChild(w);
  }
  return w;
}

function createMiniRow(key) {
  const r = document.createElement('div');
  r.className = 'rate-row';
  r.dataset.key = key;
  r.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num price"></div>
    <div class="rate-cell rate-num hl" style="font-size:.78rem;opacity:.78"></div>`;
  return r;
}

function renderMiniRows(container, items, cache) {
  if (!items || !items.length) return;
  const wrapper = ensureMiniTable(container);
  const keys = items.map(rowKey);

  const existing = new Map(
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)')).map(r => [r.dataset.key, r])
  );
  const curKeys = Array.from(wrapper.querySelectorAll('.rate-row:not(.header)')).map(r => r.dataset.key);
  if (curKeys.length !== keys.length || keys.some((k, i) => k !== curKeys[i])) {
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)')).forEach(r => r.remove());
    keys.forEach(k => wrapper.appendChild(existing.get(k) || createMiniRow(k)));
  }

  items.forEach(item => {
    const key = rowKey(item);
    const row = wrapper.querySelector(`.rate-row[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    const prev = cache.get(key) || {};
    const price = num(item.bid) ?? num(item.buy) ?? num(item.ask) ?? num(item.value);
    setText(row.querySelector('.rate-name'), item.name || key);
    patchNum(row.querySelector('.price'), price, prev.price);
    setText(row.querySelector('.hl'), `${fmt(item.high)} / ${fmt(item.low)}`);
    cache.set(key, { price });
  });
}

/* ── Karat grid ─────────────────────────────────────────── */
const KARATS = [24, 22, 21, 20, 18, 14, 10, 9];

function renderKaratGrid(master) {
  // base = 999 IMP RTGS bid/buy
  const base = num(master?.bid ?? master?.buy ?? master?.sell ?? master?.value);

  KARATS.forEach(k => {
    const key = `${k}k`;
    let card = el.goldKaratGrid.querySelector(`[data-key="${key}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'karat-card';
      card.dataset.key = key;
      card.innerHTML = `
        <div class="karat-label">
          <span class="karat-knum">${k}K</span>
          <span class="karat-note" style="font-size:.66rem;opacity:.65;font-weight:800">${k === 24 ? 'PURE' : 'LIVE'}</span>
        </div>
        <div class="karat-value">—</div>
        <div class="karat-foot">
          <span>H: <span class="kh"></span></span>
          <span>L: <span class="kl"></span></span>
        </div>`;
      el.goldKaratGrid.appendChild(card);
    }
    const rate = base != null ? Math.round(base * k / 24) : null;
    const prev = state.prev.goldKarat.get(key) || {};
    const valueEl = card.querySelector('.karat-value');
    const text = fmt(rate);
    if (valueEl.textContent !== text) valueEl.textContent = text;
    const d = dir(rate, prev.rate);
    valueEl.classList.toggle('value-up',   d === 'up');
    valueEl.classList.toggle('value-down', d === 'down');
    setText(card.querySelector('.kh'), fmt(base != null ? Math.round(base * k / 24 * 1.006) : null));
    setText(card.querySelector('.kl'), fmt(base != null ? Math.round(base * k / 24 * 0.994) : null));
    state.prev.goldKarat.set(key, { rate });
  });
}

/* ── Coin table ─────────────────────────────────────────── */
function renderCoinTable(container, coins, cache) {
  if (!coins || !coins.length) {
    if (!container.querySelector('.coin-tbl')) container.innerHTML = '<div class="empty">Loading coin rates…</div>';
    return;
  }
  let w = container.querySelector('.coin-tbl');
  if (!w) {
    w = document.createElement('div');
    w.className = 'rate-table coin-tbl';
    w.innerHTML = `<div class="rate-row header">
      <div class="rate-cell rate-name" style="flex:2">PRODUCT</div>
      <div class="rate-cell rate-num">PRICE (₹)</div>
    </div>`;
    container.innerHTML = '';
    container.appendChild(w);
  }
  const keys = coins.map(c => String(c.name || '').toLowerCase());
  const existing = new Map(Array.from(w.querySelectorAll('.rate-row:not(.header)')).map(r => [r.dataset.key, r]));
  const curKeys  = Array.from(w.querySelectorAll('.rate-row:not(.header)')).map(r => r.dataset.key);
  if (curKeys.length !== keys.length || keys.some((k, i) => k !== curKeys[i])) {
    Array.from(w.querySelectorAll('.rate-row:not(.header)')).forEach(r => r.remove());
    keys.forEach(k => {
      const r = existing.get(k) || (() => {
        const rr = document.createElement('div');
        rr.className = 'rate-row'; rr.dataset.key = k;
        rr.innerHTML = `<div class="rate-cell rate-name" style="flex:2"></div><div class="rate-cell rate-num price"></div>`;
        return rr;
      })();
      w.appendChild(r);
    });
  }
  coins.forEach(coin => {
    const key = String(coin.name || '').toLowerCase();
    const row = w.querySelector(`.rate-row[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    const prev = cache.get(key) || {};
    setText(row.querySelector('.rate-name'), coin.name);
    const priceEl = row.querySelector('.price');
    const text = `₹ ${fmt(coin.price ?? coin.bid ?? coin.ask)}`;
    if (priceEl.textContent !== text) priceEl.textContent = text;
    const d = dir(coin.price ?? coin.bid, prev.price);
    priceEl.classList.toggle('up',   d === 'up');
    priceEl.classList.toggle('down', d === 'down');
    cache.set(key, { price: coin.price ?? coin.bid });
  });
}

/* ── Status ─────────────────────────────────────────────── */
function updateStatus(data) {
  const g = !!data?.connected?.gopnath;
  const s = !!data?.connected?.swayam;
  const c = !!data?.connected?.coins;
  const n = [g, s, c].filter(Boolean).length;
  const live = n === 3;
  const partial = n >= 1;
  if (el.statusDot) el.statusDot.className = `status-dot ${live || partial ? 'live' : 'offline'}`;
  setText(el.statusText, live ? 'Live' : partial ? 'Partial' : 'Disconnected');
  setText(el.lastUpdated, timeFmt(data?.updatedAt));
}

/* ── Main render ────────────────────────────────────────── */
function renderAll(data) {
  if (!data) return;
  updateStatus(data);

  // Gold
  renderKaratGrid(data.gold?.master);
  renderProductRows(el.goldProductTable, data.gold?.products, state.prev.goldProducts);
  renderMiniRows(el.goldFutureTable, data.gold?.future, state.prev.goldFuture);
  renderMiniRows(el.goldSpotTable,   data.gold?.spot,   state.prev.goldSpot);

  // Silver
  renderProductRows(el.silverProductTable, data.silver?.products, state.prev.silverProducts);
  renderMiniRows(el.silverFutureTable, data.silver?.future, state.prev.silverFuture);
  renderMiniRows(el.silverSpotTable,   data.silver?.spot,   state.prev.silverSpot);

  // Coins
  const coinArr   = state.coinTab === 'gold' ? (data.coins?.gold || []) : (data.coins?.silver || []);
  const coinCache = state.coinTab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
  renderCoinTable(el.coinTable, coinArr, coinCache);
}

/* ── Navigation ─────────────────────────────────────────── */
function setPage(page) {
  state.currentPage = page;
  el.pages.forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  el.navItems.forEach(b => b.classList.toggle('active', b.dataset.page === page));
}

function setCoinTab(tab) {
  state.coinTab = tab;
  el.coinTabGold.classList.toggle('active',   tab === 'gold');
  el.coinTabSilver.classList.toggle('active', tab === 'silver');
  const old = el.coinTable.querySelector('.coin-tbl');
  if (old) old.remove();
  if (state.data) {
    const coinArr   = tab === 'gold' ? (state.data.coins?.gold || []) : (state.data.coins?.silver || []);
    const coinCache = tab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
    renderCoinTable(el.coinTable, coinArr, coinCache);
  }
}

/* ── Socket ─────────────────────────────────────────────── */
socket.on('connect',    () => { if (state.data) scheduleRender(state.data); });
socket.on('state',      data => scheduleRender(data));
socket.on('disconnect', () => {
  if (el.statusDot) el.statusDot.className = 'status-dot offline';
  setText(el.statusText, 'Disconnected');
});

/* ── Events ─────────────────────────────────────────────── */
el.navItems.forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
el.coinTabGold.addEventListener('click',   () => setCoinTab('gold'));
el.coinTabSilver.addEventListener('click', () => setCoinTab('silver'));

/* ── Boot ───────────────────────────────────────────────── */
fetch('/api/state').then(r => r.json()).then(scheduleRender).catch(() => {});
setPage('gold');
setCoinTab('gold');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}