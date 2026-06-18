/* ─── Socket ─────────────────────────────────────────────────────────────── */
const socket = io({ transports: ['websocket', 'polling'] });

/* ─── State ──────────────────────────────────────────────────────────────── */
const state = {
  data: null,
  currentPage: 'gold',
  coinTab: 'gold',
  pendingRender: false,
  prev: {
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

/* ─── Element references ─────────────────────────────────────────────────── */
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

/* ─── Utilities ──────────────────────────────────────────────────────────── */
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

function dir(current, previous) {
  const c = num(current);
  const p = num(previous);
  if (c === null || p === null || c === p) return '';
  return c > p ? 'up' : 'down';
}

function itemKey(item) {
  return String(item?.name || item?.label || item?.key || '').trim().toLowerCase();
}

/* ─── Karat grid (computed from master gold price) ────────────────────────── */
const KARAT_FACTORS = [24, 22, 21, 20, 18, 14, 10, 9];

function buildKarats(master) {
  const base = num(master?.sell ?? master?.buy ?? master?.value);
  return KARAT_FACTORS.map((k) => ({
    label: `${k}K`,
    note: k === 24 ? 'PURE' : 'LIVE',
    rate: base !== null ? Math.round(base * (k / 24)) : null,
    high: base !== null ? Math.round(base * (k / 24) * 1.006) : null,
    low:  base !== null ? Math.round(base * (k / 24) * 0.994) : null,
  }));
}

function renderKaratGrid(master) {
  const cards = buildKarats(master);
  const existing = new Map(
    Array.from(el.goldKaratGrid.querySelectorAll('.karat-card'))
      .map((n) => [n.dataset.key, n])
  );
  const next = [];

  cards.forEach((card) => {
    const key = card.label;
    let node = existing.get(key);
    if (!node) {
      node = document.createElement('article');
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
        </div>
      `;
    }
    const prev = state.prev.goldProducts.get(key) || {};
    node.querySelector('.karat-name').textContent = card.label;
    node.querySelector('.karat-note').textContent = card.note || '';
    const valueEl = node.querySelector('.karat-value');
    valueEl.textContent = fmt(card.rate);
    valueEl.classList.remove('value-up', 'value-down');
    const d = dir(card.rate, prev.rate);
    if (d === 'up')   valueEl.classList.add('value-up');
    if (d === 'down') valueEl.classList.add('value-down');
    node.querySelector('.karat-high').textContent = fmt(card.high);
    node.querySelector('.karat-low').textContent  = fmt(card.low);
    state.prev.goldProducts.set(key, { rate: card.rate });
    next.push(node);
    existing.delete(key);
  });

  el.goldKaratGrid.replaceChildren(...next);
}

/* ─── Rate-row table (products / future / spot) ─────────────────────────── */
/*
 * items: array of normalizeItem objects from server
 *   { name, buy, sell, high, low, value }
 */
function renderRateTable(container, items, cacheMap, cols) {
  const data = items || [];

  if (!data.length) {
    container.innerHTML = '<div class="empty">Waiting for data…</div>';
    return;
  }

  const columns = cols || ['PRODUCT', 'BUY', 'SELL', 'HIGH', 'LOW'];
  const isMini  = columns.length <= 3;

  // Build wrapper once
  let wrapper = container.querySelector('.rate-table');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'rate-table';
    const headerCells = columns.map((c) => {
      const cls = c === 'PRODUCT' ? 'rate-name' : 'rate-num';
      return `<div class="rate-cell ${cls}">${c}</div>`;
    }).join('');
    wrapper.innerHTML = `<div class="rate-row header">${headerCells}</div>`;
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  const existing = new Map(
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)'))
      .map((r) => [r.dataset.key, r])
  );
  const nextRows = [];

  data.forEach((item) => {
    const key = itemKey(item);
    let row = existing.get(key);
    if (!row) {
      row = document.createElement('div');
      row.className = 'rate-row';
      row.dataset.key = key;
      if (isMini) {
        row.innerHTML = `
          <div class="rate-cell rate-name"></div>
          <div class="rate-cell rate-num price"></div>
          <div class="rate-cell rate-num" style="font-size:.8rem;opacity:.75">
            H:<span class="hi"></span> L:<span class="lo"></span>
          </div>
        `;
      } else {
        row.innerHTML = `
          <div class="rate-cell rate-name"></div>
          <div class="rate-cell rate-num buy"></div>
          <div class="rate-cell rate-num sell"></div>
          <div class="rate-cell rate-num high"></div>
          <div class="rate-cell rate-num low"></div>
        `;
      }
    }

    const prev = cacheMap.get(key) || {};
    row.querySelector('.rate-name').textContent = item.name || item.label || key;

    if (isMini) {
      const priceVal = item.sell ?? item.buy ?? item.value;
      const priceEl  = row.querySelector('.rate-num.price');
      priceEl.textContent = fmt(priceVal);
      priceEl.classList.remove('up', 'down');
      const d = dir(priceVal, prev.price);
      if (d === 'up')   priceEl.classList.add('up');
      if (d === 'down') priceEl.classList.add('down');
      row.querySelector('.hi').textContent = fmt(item.high);
      row.querySelector('.lo').textContent = fmt(item.low);
      cacheMap.set(key, { price: priceVal });
    } else {
      function applyCell(selector, val, prevVal) {
        const cell = row.querySelector(selector);
        if (!cell) return;
        cell.textContent = fmt(val);
        cell.classList.remove('up', 'down');
        const d = dir(val, prevVal);
        if (d === 'up')   cell.classList.add('up');
        if (d === 'down') cell.classList.add('down');
      }
      applyCell('.buy',  item.buy,  prev.buy);
      applyCell('.sell', item.sell, prev.sell);
      applyCell('.high', item.high, prev.high);
      applyCell('.low',  item.low,  prev.low);
      cacheMap.set(key, { buy: item.buy, sell: item.sell, high: item.high, low: item.low });
    }

    nextRows.push(row);
    existing.delete(key);
  });

  const header = wrapper.querySelector('.rate-row.header');
  wrapper.replaceChildren(header, ...nextRows);
}

/* ─── Coin table ─────────────────────────────────────────────────────────── */
function renderCoinTable(container, coins, cacheMap) {
  const data = coins || [];

  if (!data.length) {
    container.innerHTML = '<div class="empty">Coin data loading… (scraped every 30 s)</div>';
    return;
  }

  let wrapper = container.querySelector('.rate-table');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'rate-table';
    wrapper.innerHTML = `
      <div class="rate-row header">
        <div class="rate-cell rate-name" style="flex:2">PRODUCT</div>
        <div class="rate-cell rate-num">PRICE (₹)</div>
      </div>
    `;
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  const existing = new Map(
    Array.from(wrapper.querySelectorAll('.rate-row:not(.header)'))
      .map((r) => [r.dataset.key, r])
  );
  const nextRows = [];

  data.forEach((coin) => {
    const key = String(coin.name || '').toLowerCase();
    let row = existing.get(key);
    if (!row) {
      row = document.createElement('div');
      row.className = 'rate-row';
      row.dataset.key = key;
      row.innerHTML = `
        <div class="rate-cell rate-name" style="flex:2"></div>
        <div class="rate-cell rate-num price"></div>
      `;
    }
    const prev = cacheMap.get(key) || {};
    row.querySelector('.rate-name').textContent = coin.name;
    const priceEl = row.querySelector('.rate-num.price');
    priceEl.textContent = `₹ ${fmt(coin.price)}`;
    priceEl.classList.remove('up', 'down');
    const d = dir(coin.price, prev.price);
    if (d === 'up')   priceEl.classList.add('up');
    if (d === 'down') priceEl.classList.add('down');
    cacheMap.set(key, { price: coin.price });
    nextRows.push(row);
    existing.delete(key);
  });

  const header = wrapper.querySelector('.rate-row.header');
  wrapper.replaceChildren(header, ...nextRows);
}

/* ─── Status chip ─────────────────────────────────────────────────────────── */
function statusFrom(data) {
  const g = !!data?.connected?.gopnath;
  const s = !!data?.connected?.swayam;
  const c = !!data?.connected?.coins;
  const count = [g, s, c].filter(Boolean).length;
  if (count === 3) return { text: 'Live',        cls: 'live' };
  if (count >= 1)  return { text: 'Partial',     cls: 'live' };
  return               { text: 'Disconnected', cls: 'offline' };
}

/* ─── Main render ─────────────────────────────────────────────────────────── */
function renderData(data) {
  if (!data) return;
  state.data = data;

  // Status + timestamp
  const status = statusFrom(data);
  if (el.statusDot) el.statusDot.className = `status-dot ${status.cls}`;
  setText(el.statusText, status.text);
  setText(el.lastUpdated, timeFmt(data.updatedAt));

  // Gold karats (from master price)
  renderKaratGrid(data.gold?.master);

  // Gold products
  renderRateTable(
    el.goldProductTable,
    data.gold?.products || [],
    state.prev.goldProducts,
    ['PRODUCT', 'BUY', 'SELL', 'HIGH', 'LOW']
  );

  // Gold future / spot
  renderRateTable(el.goldFutureTable, data.gold?.future || [], state.prev.goldFuture, ['NAME', 'PRICE', 'H / L']);
  renderRateTable(el.goldSpotTable,   data.gold?.spot   || [], state.prev.goldSpot,   ['NAME', 'PRICE', 'H / L']);

  // Silver products
  renderRateTable(
    el.silverProductTable,
    data.silver?.products || [],
    state.prev.silverProducts,
    ['PRODUCT', 'BUY', 'SELL', 'HIGH', 'LOW']
  );

  // Silver future / spot
  renderRateTable(el.silverFutureTable, data.silver?.future || [], state.prev.silverFuture, ['NAME', 'PRICE', 'H / L']);
  renderRateTable(el.silverSpotTable,   data.silver?.spot   || [], state.prev.silverSpot,   ['NAME', 'PRICE', 'H / L']);

  // Coins — active tab only
  const coinRows  = state.coinTab === 'gold' ? (data.coins?.gold || []) : (data.coins?.silver || []);
  const coinCache = state.coinTab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
  renderCoinTable(el.coinTable, coinRows, coinCache);
}

function scheduleRender(data) {
  state.data = data;
  if (state.pendingRender) return;
  state.pendingRender = true;
  requestAnimationFrame(() => {
    state.pendingRender = false;
    renderData(state.data);
  });
}

/* ─── Navigation ─────────────────────────────────────────────────────────── */
function setPage(page) {
  state.currentPage = page;
  el.pages.forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  el.navItems.forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

function setCoinTab(tab) {
  state.coinTab = tab;
  el.coinTabGold.classList.toggle('active',   tab === 'gold');
  el.coinTabSilver.classList.toggle('active', tab === 'silver');
  if (state.data) {
    const coinRows  = tab === 'gold' ? (state.data.coins?.gold || []) : (state.data.coins?.silver || []);
    const coinCache = tab === 'gold' ? state.prev.coinGold : state.prev.coinSilver;
    // Reset wrapper so table is rebuilt fresh for the new tab
    el.coinTable.innerHTML = '';
    renderCoinTable(el.coinTable, coinRows, coinCache);
  }
}

/* ─── Socket events ──────────────────────────────────────────────────────── */
socket.on('connect', () => {
  if (state.data) scheduleRender(state.data);
});

// Server emits 'state' event
socket.on('state', (data) => {
  scheduleRender(data);
});

socket.on('disconnect', () => {
  if (el.statusDot) el.statusDot.className = 'status-dot offline';
  setText(el.statusText, 'Disconnected');
});

/* ─── Event listeners ────────────────────────────────────────────────────── */
el.navItems.forEach((btn) => {
  btn.addEventListener('click', () => setPage(btn.dataset.page));
});

el.coinTabGold.addEventListener('click',   () => setCoinTab('gold'));
el.coinTabSilver.addEventListener('click', () => setCoinTab('silver'));

/* ─── Initial load via REST ──────────────────────────────────────────────── */
fetch('/api/state')
  .then((res) => res.json())
  .then((data) => scheduleRender(data))
  .catch(() => {});

/* ─── Boot ───────────────────────────────────────────────────────────────── */
setPage('gold');
setCoinTab('gold');

/* ─── Service Worker ─────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}