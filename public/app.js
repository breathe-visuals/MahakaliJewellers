/* global io */
const socket = io({ transports: ['websocket', 'polling'] });

const state = {
  data: null,
  currentPage: 'gold',
  coinTab: 'gold',
  renderTimer: null,
  lastRender: 0,
  prev: {
    goldKarat: new Map(),
    goldProducts: new Map(),
    goldFutureSpot: new Map(),
    silverProducts: new Map(),
    silverFutureSpot: new Map(),
    coinGold: new Map(),
    coinSilver: new Map()
  }
};

const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  lastUpdated: document.getElementById('lastUpdated'),

  goldKaratGrid: document.getElementById('goldKaratGrid'),
  goldProductTable: document.getElementById('goldProductTable'),
  goldFutureSpotTable: document.getElementById('goldFutureSpotTable'),

  silverProductTable: document.getElementById('silverProductTable'),
  silverFutureSpotTable: document.getElementById('silverFutureSpotTable'),

  coinTable: document.getElementById('coinTable'),
  coinTabGold: document.getElementById('coinTabGold'),
  coinTabSilver: document.getElementById('coinTabSilver'),

  navItems: Array.from(document.querySelectorAll('.nav-item')),
  pages: Array.from(document.querySelectorAll('.page'))
};

const KARAT_FACTORS = [24, 22, 21, 20, 18, 14, 10, 9];

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

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, '').replace(/,/g, ''));
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
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function setText(node, v) {
  if (!node) return;
  const s = String(v ?? '—');
  if (node.textContent !== s) node.textContent = s;
}

function dir(cur, prv) {
  const c = num(cur);
  const p = num(prv);
  if (c == null || p == null || c === p) return '';
  return c > p ? 'up' : 'down';
}

function patchNum(cell, val, prevVal) {
  if (!cell) return;
  const text = fmt(val);
  if (cell.textContent !== text) cell.textContent = text;
  const d = dir(val, prevVal);
  const wasUp = cell.classList.contains('up');
  const wasDown = cell.classList.contains('down');
  if (wasUp !== (d === 'up')) cell.classList.toggle('up', d === 'up');
  if (wasDown !== (d === 'down')) cell.classList.toggle('down', d === 'down');
}

function rowKey(item) {
  return String(item?.name || item?.label || item?.key || '')
    .trim()
    .toLowerCase();
}

function ensureTable(container, className, headerHTML) {
  let wrapper = container.querySelector(`.${className}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = className;
    wrapper.innerHTML = headerHTML;
    container.innerHTML = '';
    container.appendChild(wrapper);
  }
  return wrapper;
}

function syncRows(wrapper, keys, createRow) {
  const existing = new Map(
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)'))
      .map((r) => [r.dataset.key, r])
  );

  const current = Array.from(wrapper.querySelectorAll('.rate-row:not(.header)'))
    .map((r) => r.dataset.key);

  const same = current.length === keys.length && keys.every((k, i) => k === current[i]);
  if (same) return (key) => existing.get(key);

  const header = wrapper.querySelector('.rate-row.header');
  const nextRows = keys.map((key) => existing.get(key) || createRow(key));
  wrapper.replaceChildren(header, ...nextRows);

  const map = new Map(nextRows.map((r) => [r.dataset.key, r]));
  return (key) => map.get(key);
}

function buildKarats(master) {
  const base = num(master?.sell ?? master?.bid ?? master?.buy ?? master?.ask ?? master?.value);
  return KARAT_FACTORS.map((k) => ({
    label: `${k}K`,
    note: k === 24 ? 'PURE' : 'LIVE',
    rate: base !== null ? Math.round(base * (k / 24)) : null,
    high: base !== null ? Math.round(base * (k / 24) * 1.006) : null,
    low: base !== null ? Math.round(base * (k / 24) * 0.994) : null
  }));
}

function createKaratCard(key) {
  const node = document.createElement('article');
  node.className = 'karat-card';
  node.dataset.key = key;
  node.innerHTML = `
    <div class="karat-label">
      <span class="karat-knum"></span>
      <span class="karat-note" style="font-size:.66rem;opacity:.65;font-weight:800"></span>
    </div>
    <div class="karat-value">—</div>
    <div class="karat-foot">
      <span>H: <span class="kh"></span></span>
      <span>L: <span class="kl"></span></span>
    </div>`;
  return node;
}

function renderKaratGrid(master) {
  const cards = buildKarats(master);
  const keys = cards.map((c) => c.label);

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
    setText(node.querySelector('.karat-knum'), card.label);
    setText(node.querySelector('.karat-note'), card.note || '');
    setText(node.querySelector('.kh'), fmt(card.high));
    setText(node.querySelector('.kl'), fmt(card.low));

    const valueEl = node.querySelector('.karat-value');
    const text = fmt(card.rate);
    if (valueEl.textContent !== text) valueEl.textContent = text;

    const d = dir(card.rate, prev.rate);
    valueEl.classList.toggle('value-up', d === 'up');
    valueEl.classList.toggle('value-down', d === 'down');

    state.prev.goldKarat.set(card.label, { rate: card.rate });
  });
}

const PRODUCT_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name">PRODUCT</div>
    <div class="rate-cell rate-num">BUY</div>
    <div class="rate-cell rate-num">SELL</div>
    <div class="rate-cell rate-num">ACTION</div>
  </div>`;

function createProductRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row product-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num buy"></div>
    <div class="rate-cell rate-num sell"></div>
    <div class="rate-cell rate-num action"><button class="action-btn" type="button">BUY</button></div>`;
  return row;
}

function renderProductRows(container, items, cache) {
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty">Waiting for product data…</div>';
    return;
  }

  const wrapper = ensureTable(container, 'product-table', PRODUCT_HEADER);
  const keys = items.map(rowKey);
  const getRow = syncRows(wrapper, keys, createProductRow);

  items.forEach((item) => {
    const key = rowKey(item);
    const row = getRow(key);
    if (!row) return;

    const prev = cache.get(key) || {};
    const buy = item.bid ?? item.buy ?? item.value;
    const sell = item.ask ?? item.sell ?? item.value;

    setText(row.querySelector('.rate-name'), item.name || key);
    patchNum(row.querySelector('.buy'), buy, prev.buy);
    patchNum(row.querySelector('.sell'), sell, prev.sell);

    cache.set(key, { buy, sell });
  });
}

const FUTURE_SPOT_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name">TYPE</div>
    <div class="rate-cell rate-num">BUY</div>
    <div class="rate-cell rate-num">SELL</div>
    <div class="rate-cell rate-num">H / L</div>
  </div>`;

function createFutureSpotRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row future-spot-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num buy"></div>
    <div class="rate-cell rate-num sell"></div>
    <div class="rate-cell rate-num hl"></div>`;
  return row;
}

function renderFutureSpotTable(container, futureItems, spotItems, cache) {
  const future = (futureItems || [])[0] || null;
  const spot = (spotItems || [])[0] || null;

  if (!future && !spot) {
    container.innerHTML = '<div class="empty">Waiting for future / spot data…</div>';
    return;
  }

  const wrapper = ensureTable(container, 'future-spot-table', FUTURE_SPOT_HEADER);

  const rows = [
    { key: 'future', label: 'FUTURE', item: future },
    { key: 'spot', label: 'SPOT / COMEX', item: spot }
  ].filter((x) => x.item);

  const keys = rows.map((r) => r.key);
  const getRow = syncRows(wrapper, keys, createFutureSpotRow);

  rows.forEach(({ key, label, item }) => {
    const row = getRow(key);
    if (!row) return;

    const prev = cache.get(key) || {};
    const buy = item.bid ?? item.buy ?? item.value;
    const sell = item.ask ?? item.sell ?? item.value;

    setText(row.querySelector('.rate-name'), label);
    patchNum(row.querySelector('.buy'), buy, prev.buy);
    patchNum(row.querySelector('.sell'), sell, prev.sell);
    setText(row.querySelector('.hl'), `${fmt(item.high)} / ${fmt(item.low)}`);

    cache.set(key, { buy, sell });
  });
}

const COIN_HEADER = `
  <div class="rate-row header">
    <div class="rate-cell rate-name">PRODUCT</div>
    <div class="rate-cell rate-num">PRICE (₹)</div>
  </div>`;

function createCoinRow(key) {
  const row = document.createElement('div');
  row.className = 'rate-row coin-row';
  row.dataset.key = key;
  row.innerHTML = `
    <div class="rate-cell rate-name"></div>
    <div class="rate-cell rate-num price"></div>`;
  return row;
}

function renderCoinTable(container, coins, cache) {
  if (!coins || !coins.length) {
    container.innerHTML = '<div class="empty">Coin data loading…</div>';
    return;
  }

  const wrapper = ensureTable(container, 'coin-table', COIN_HEADER);
  const keys = coins.map((c) => String(c.name || '').toLowerCase());
  const getRow = syncRows(wrapper, keys, createCoinRow);

  coins.forEach((coin) => {
    const key = String(coin.name || '').toLowerCase();
    const row = getRow(key);
    if (!row) return;

    const prev = cache.get(key) || {};
    const price = coin.price ?? coin.bid ?? coin.ask;

    setText(row.querySelector('.rate-name'), coin.name);
    patchNum(row.querySelector('.price'), price, prev.price);

    cache.set(key, { price });
  });
}

function updateStatus(data) {
  const g = !!data?.connected?.gopnath;
  const s = !!data?.connected?.swayam;
  const c = !!data?.connected?.coins;
  const n = [g, s, c].filter(Boolean).length;

  const live = n === 3;
  const partial = n >= 1;

  if (el.statusDot) {
    el.statusDot.className = `status-dot ${live || partial ? 'live' : 'offline'}`;
  }

  setText(el.statusText, live ? 'Live' : partial ? 'Partial' : 'Disconnected');
  setText(el.lastUpdated, timeFmt(data?.updatedAt));
}

function renderAll(data) {
  if (!data) return;

  updateStatus(data);

  renderKaratGrid(data.gold?.master);

  renderProductRows(el.goldProductTable, data.gold?.products, state.prev.goldProducts);
  renderFutureSpotTable(
    el.goldFutureSpotTable,
    data.gold?.future,
    data.gold?.spot,
    state.prev.goldFutureSpot
  );

  renderProductRows(el.silverProductTable, data.silver?.products, state.prev.silverProducts);
  renderFutureSpotTable(
    el.silverFutureSpotTable,
    data.silver?.future,
    data.silver?.spot,
    state.prev.silverFutureSpot
  );

  const coinArr = state.coinTab === 'gold'
    ? (data.coins?.gold || [])
    : (data.coins?.silver || []);

  const coinCache = state.coinTab === 'gold'
    ? state.prev.coinGold
    : state.prev.coinSilver;

  renderCoinTable(el.coinTable, coinArr, coinCache);
}

function setPage(page) {
  state.currentPage = page;
  el.pages.forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  el.navItems.forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

function setCoinTab(tab) {
  state.coinTab = tab;
  el.coinTabGold.classList.toggle('active', tab === 'gold');
  el.coinTabSilver.classList.toggle('active', tab === 'silver');

  const old = el.coinTable.querySelector('.coin-table');
  if (old) old.remove();

  if (state.data) {
    const coinArr = tab === 'gold'
      ? (state.data.coins?.gold || [])
      : (state.data.coins?.silver || []);

    const coinCache = tab === 'gold'
      ? state.prev.coinGold
      : state.prev.coinSilver;

    renderCoinTable(el.coinTable, coinArr, coinCache);
  }
}

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

el.navItems.forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
el.coinTabGold.addEventListener('click', () => setCoinTab('gold'));
el.coinTabSilver.addEventListener('click', () => setCoinTab('silver'));

fetch('/api/state')
  .then((r) => r.json())
  .then((data) => scheduleRender(data))
  .catch(() => { });

setPage('gold');
setCoinTab('gold');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  });
}