/* ─── Socket ──────────────────────────────────────────────────────────────── */
const socket = io({ transports: ['websocket', 'polling'] });

/* ─── State ───────────────────────────────────────────────────────────────── */
const state = {
  data: null,
  currentPage: 'gold',
  coinTab: 'gold',
  renderTimer: null,
  lastRender: 0,
  prev: {
    goldKarat: new Map(),
    goldProducts: new Map(),
    goldFuture: new Map(),
    goldSpot: new Map(),
    silverProducts: new Map(),
    silverFuture: new Map(),
    silverSpot: new Map(),
    coinGold: new Map(),
    coinSilver: new Map(),
  },
};

/* ─── Element references ──────────────────────────────────────────────────── */
const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  lastUpdated: document.getElementById('lastUpdated'),
  goldKaratGrid: document.getElementById('goldKaratGrid'),
  goldProductTable: document.getElementById('goldProductTable'),
  goldFutureTable: document.getElementById('goldFutureTable'),
  goldSpotTable: document.getElementById('goldSpotTable'),
  silverProductTable: document.getElementById('silverProductTable'),
  silverFutureTable: document.getElementById('silverFutureTable'),
  silverSpotTable: document.getElementById('silverSpotTable'),
  coinTable: document.getElementById('coinTable'),
  coinTabGold: document.getElementById('coinTabGold'),
  coinTabSilver: document.getElementById('coinTabSilver'),
  navItems: Array.from(document.querySelectorAll('.nav-item')),
  pages: Array.from(document.querySelectorAll('.page')),
};

/* ─── Throttled render (max once per second) ──────────────────────────────── */
const RENDER_INTERVAL = 1000; // ms

function scheduleRender(data) {
  state.data = data;
  if (state.renderTimer) return; // already pending

  const now = Date.now();
  const wait = Math.max(0, RENDER_INTERVAL - (now - state.lastRender));

  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    state.lastRender = Date.now();
    renderData(state.data);
  }, wait);
}

/* ─── Utilities ───────────────────────────────────────────────────────────── */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fmt(v) {
  const n = num(v);
  return n === null ? '—' : n.toLocaleString('en-IN');
}

function timeFmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function setText(node, value) {
  if (!node) return;
  const next = String(value ?? '—');
  if (node.textContent !== next) node.textContent = next;
}

function priceDir(cur, prev) {
  const c = num(cur), p = num(prev);
  if (c === null || p === null || c === p) return '';
  return c > p ? 'up' : 'down';
}

function itemKey(item) {
  return String(item?.name || item?.label || item?.key || '').trim().toLowerCase();
}

/* ─── Stable DOM helpers ──────────────────────────────────────────────────── */
// Update cell in-place; only touch the DOM when value or direction changed.
function patchCell(cell, val, prevVal) {
  const d = priceDir(val, prevVal);
  const text = fmt(val);
  if (cell.textContent !== text) cell.textContent = text;
  const wasUp = cell.classList.contains('up');
  const wasDown = cell.classList.contains('down');
  const isUp = d === 'up', isDown = d === 'down';
  if (wasUp !== isUp) cell.classList.toggle('up', isUp);
  if (wasDown !== isDown) cell.classList.toggle('down', isDown);
}

// Ensure a wrapper div exists in container; returns [wrapper, isNew]
function ensureWrapper(container, cls, headerHTML) {
  let w = container.querySelector(`.${cls}`);
  if (!w) {
    w = document.createElement('div');
    w.className = cls;
    w.innerHTML = headerHTML;
    container.innerHTML = '';
    container.appendChild(w);
    return [w, true];
  }
  return [w, false];
}

// Sync DOM rows to match `keys` order, reusing existing row nodes.
// Creates new rows via `createRow(key)` if needed.
// Only calls replaceChildren when the set/order of keys actually changes.
function syncRows(wrapper, keys, createRow) {
  const existing = new Map(
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)')).map((r) => [r.dataset.key, r])
  );

  // Check if update needed (fast path: same keys in same order)
  const current = Array.from(wrapper.querySelectorAll('.rate-row:not(.header)')).map((r) => r.dataset.key);
  const same = current.length === keys.length && keys.every((k, i) => k === current[i]);
  if (same) return (key) => existing.get(key);

  const header = wrapper.querySelector('.rate-row.header');
  const nextRows = keys.map((key) => {
    if (existing.has(key)) return existing.get(key);
    return createRow(key);
  });
  wrapper.replaceChildren(header, ...nextRows);

  const map = new Map(nextRows.map((r) => [r.dataset.key, r]));
  return (key) => map.get(key);
}

/* ─── Karat grid ──────────────────────────────────────────────────────────── */
const KARAT_FACTORS = [24, 22, 21, 20, 18, 14, 10, 9];

function buildKarats(master) {
  // master now has buy=bid, sell=ask|bid from server mapProduct()
  const base = num(master?.sell ?? master?.buy ?? master?.bid ?? master?.ask ?? master?.value);
  return KARAT_FACTORS.map((k) => ({
    label: `${k}K`,
    note: k === 24 ? 'PURE' : 'LIVE',
    rate: base !== null ? Math.round(base * (k / 24)) : null,
    high: base !== null ? Math.round(base * (k / 24) * 1.006) : null,
    low: base !== null ? Math.round(base * (k / 24) * 0.994) : null,
  }));
}

function createKaratCard(key) {
  const node = document.createElement('article');
  node.className = 'karat-card';
  node.dataset.key = key;
  node.innerHTML = `
    <div class="karat-label">
      <span class="karat-name"></span>
      <span class="karat-note" style="font-size:.68rem;opacity:.7;font-weight:700"></span>
    </div>
    <div class="karat-value"></div>
    <div class="karat-foot">
      <span>H: <span class="karat-high"></span></span>
      <span>L: <span class="karat-low"></span></span>
    </div>`;
  return node;
}

function renderKaratGrid(master) {
  const cards = buildKarats(master);
  const keys = cards.map((c) => c.label);

  // Sync card nodes
  const existingMap = new Map(
    Array.from(el.goldKaratGrid.querySelectorAll('.karat-card')).map((n) => [n.dataset.key, n])
  );
  const currentKeys = Array.from(el.goldKaratGrid.querySelectorAll('.karat-card')).map((n) => n.dataset.key);
  const same = currentKeys.length === keys.length && keys.every((k, i) => k === currentKeys[i]);

  let getNode;
  if (!same) {
    const nodes = keys.map((k) => existingMap.get(k) || createKaratCard(k));
    el.goldKaratGrid.replaceChildren(...nodes);
    getNode = (k) => nodes[keys.indexOf(k)];
  } else {
    getNode = (k) => existingMap.get(k);
  }

  cards.forEach((card) => {
    const node = getNode(card.label);
    if (!node) return;
    const prev = state.prev.goldKarat.get(card.label) || {};

    setText(node.querySelector('.karat-name'), card.label);
    setText(node.querySelector('.karat-note'), card.note || '');
    setText(node.querySelector('.karat-high'), fmt(card.high));
    setText(node.querySelector('.karat-low'), fmt(card.low));

    const valueEl = node.querySelector('.karat-value');
    const text = fmt(card.rate);
    const d = priceDir(card.rate, prev.rate);
    if (valueEl.textContent !== text) valueEl.textContent = text;
    const wasUp = valueEl.classList.contains('value-up');
    const wasDown = valueEl.classList.contains('value-down');
    if (wasUp !== (d === 'up')) valueEl.classList.toggle('value-up', d === 'up');
    if (wasDown !== (d === 'down')) valueEl.classList.toggle('value-down', d === 'down');

    state.prev.goldKarat.set(card.label, { rate: card.rate });
  });
}

/* ─── Product table (5-col) ───────────────────────────────────────────────── */
const PRODUCT_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name">PRODUCT</div>
    <div class="rate-cell rate-num">BUY</div>
    <div class="rate-cell rate-num">SELL</div>
    <div class="rate-cell rate-num">HIGH</div>
    <div class="rate-cell rate-num">LOW</div>
  </div>`;

function createProductRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num buy"></div>
    <div class="rate-cell rate-num sell"></div>
    <div class="rate-cell rate-num high"></div>
    <div class="rate-cell rate-num low"></div>`;
  return row;
}

function renderProductTable(container, items, cacheMap) {
  if (!items || !items.length) return;

  const [wrapper] = ensureWrapper(container, 'rate-table prod-tbl', PRODUCT_HEADER);
  const keys = items.map(itemKey);
  const getRow = syncRows(wrapper, keys, createProductRow);

  items.forEach((item) => {
    const key = itemKey(item);
    const row = getRow(key);
    if (!row) return;
    const prev = cacheMap.get(key) || {};

    setText(row.querySelector('.rate-name'), item.name || key);
    patchCell(row.querySelector('.buy'),  item.buy,  prev.buy);
    patchCell(row.querySelector('.sell'), item.sell, prev.sell);
    patchCell(row.querySelector('.high'), item.high, prev.high);
    patchCell(row.querySelector('.low'),  item.low,  prev.low);

    cacheMap.set(key, { buy: item.buy, sell: item.sell, high: item.high, low: item.low });
  });
}

/* ─── Mini table (3-col: name price h/l) ─────────────────────────────────── */
const MINI_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name">NAME</div>
    <div class="rate-cell rate-num">PRICE</div>
    <div class="rate-cell rate-num" style="font-size:.8rem">H / L</div>
  </div>`;

function createMiniRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num price"></div>
    <div class="rate-cell rate-num hl" style="font-size:.8rem;opacity:.75"></div>`;
  return row;
}

function renderMiniTable(container, items, cacheMap) {
  if (!items || !items.length) return;

  const [wrapper] = ensureWrapper(container, 'rate-table mini-tbl', MINI_HEADER);
  const keys = items.map(itemKey);
  const getRow = syncRows(wrapper, keys, createMiniRow);

  items.forEach((item) => {
    const key = itemKey(item);
    const row = getRow(key);
    if (!row) return;
    const prev = cacheMap.get(key) || {};
    const priceVal = num(item.sell) ?? num(item.buy) ?? num(item.value);

    setText(row.querySelector('.rate-name'), item.name || key);
    patchCell(row.querySelector('.price'), priceVal, prev.price);
    setText(row.querySelector('.hl'), `${fmt(item.high)} / ${fmt(item.low)}`);

    cacheMap.set(key, { price: priceVal });
  });
}

/* ─── Coin table ──────────────────────────────────────────────────────────── */
const COIN_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name" style="flex:2">PRODUCT</div>
    <div class="rate-cell rate-num">PRICE (₹)</div>
  </div>`;

function createCoinRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name" style="flex:2"></div>
    <div class="rate-cell rate-num price"></div>`;
  return row;
}

function renderCoinTable(container, coins, cacheMap) {
  if (!coins || !coins.length) {
    if (!container.querySelector('.rate-table.coin-tbl'))
      container.innerHTML = '<div class="empty">Coin data loading…</div>';
    return;
  }

  const [wrapper] = ensureWrapper(container, 'rate-table coin-tbl', COIN_HEADER);
  const keys = coins.map((c) => String(c.name || '').toLowerCase());
  const getRow = syncRows(wrapper, keys, createCoinRow);

  coins.forEach((coin) => {
    const key = String(coin.name || '').toLowerCase();
    const row = getRow(key);
    if (!row) return;
    const prev = cacheMap.get(key) || {};

    setText(row.querySelector('.rate-name'), coin.name);
    const priceEl = row.querySelector('.price');
    const text = `₹ ${fmt(coin.price)}`;
    if (priceEl.textContent !== text) priceEl.textContent = text;
    const d = priceDir(coin.price, prev.price);
    if (priceEl.classList.contains('up') !== (d === 'up')) priceEl.classList.toggle('up', d === 'up');
    if (priceEl.classList.contains('down') !== (d === 'down')) priceEl.classList.toggle('down', d === 'down');

    cacheMap.set(key, { price: coin.price });
  });
}

/* ─── Status ──────────────────────────────────────────────────────────────── */
function statusFrom(data) {
  const g = !!data?.connected?.gopnath;
  const s = !!data?.connected?.swayam;
  const c = !!data?.connected?.coins;
  const count = [g, s, c].filter(Boolean).length;
  if (count === 3) return { text: 'Live', cls: 'live' };
  if (count >= 1) return { text: 'Partial', cls: 'live' };
  return { text: 'Disconnected', cls: 'offline' };
}

/* ─── Main render ─────────────────────────────────────────────────────────── */
function renderData(data) {
  if (!data) return;

  const status = statusFrom(data);
  if (el.statusDot) el.statusDot.className = `status-dot ${status.cls}`;
  setText(el.statusText, status.text);
  setText(el.lastUpdated, timeFmt(data.updatedAt));

  renderKaratGrid(data.gold?.master);
  renderProductTable(el.goldProductTable, data.gold?.products, state.prev.goldProducts);
  renderMiniTable(el.goldFutureTable, data.gold?.future, state.prev.goldFuture);
  renderMiniTable(el.goldSpotTable, data.gold?.spot, state.prev.goldSpot);

  renderProductTable(el.silverProductTable, data.silver?.products, state.prev.silverProducts);
  renderMiniTable(el.silverFutureTable, data.silver?.future, state.prev.silverFuture);
  renderMiniTable(el.silverSpotTable, data.silver?.spot, state.prev.silverSpot);

  const coinRows = state.coinTab === 'gold' ? (data.coins?.gold || []) : (data.coins?.silver || []);
  const coinCache = state.coinTab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
  renderCoinTable(el.coinTable, coinRows, coinCache);
}

/* ─── Navigation ──────────────────────────────────────────────────────────── */
function setPage(page) {
  state.currentPage = page;
  el.pages.forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  el.navItems.forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

function setCoinTab(tab) {
  state.coinTab = tab;
  el.coinTabGold.classList.toggle('active', tab === 'gold');
  el.coinTabSilver.classList.toggle('active', tab === 'silver');
  // Remove coin-tbl so it rebuilds fresh for new tab
  const old = el.coinTable.querySelector('.rate-table.coin-tbl');
  if (old) old.remove();
  if (state.data) {
    const coinRows = tab === 'gold' ? (state.data.coins?.gold || []) : (state.data.coins?.silver || []);
    const coinCache = tab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
    renderCoinTable(el.coinTable, coinRows, coinCache);
  }
}

/* ─── Socket ──────────────────────────────────────────────────────────────── */
socket.on('connect', () => {
  if (state.data) scheduleRender(state.data);
});

socket.on('state', (data) => {
  scheduleRender(data);
});

socket.on('disconnect', () => {
  if (el.statusDot) el.statusDot.className = 'status-dot offline';
  setText(el.statusText, 'Disconnected');
});

/* ─── Events ──────────────────────────────────────────────────────────────── */
el.navItems.forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
el.coinTabGold.addEventListener('click', () => setCoinTab('gold'));
el.coinTabSilver.addEventListener('click', () => setCoinTab('silver'));

/* ─── Initial load ────────────────────────────────────────────────────────── */
fetch('/api/state')
  .then((r) => r.json())
  .then((data) => scheduleRender(data))
  .catch(() => {});

/* ─── Boot ────────────────────────────────────────────────────────────────── */
setPage('gold');
setCoinTab('gold');

/* ─── Service Worker ──────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}