const socket = io({ transports: ['websocket', 'polling'] });

const state = {
  snapshot: null,
  currentPage: 'gold',
  coinTab: 'gold',
  pendingRender: false,
  prev: {
    goldKarat: new Map(),
    goldRates: new Map(),
    goldFuture: new Map(),
    goldSpot: new Map(),
    silverRates: new Map(),
    silverFuture: new Map(),
    silverSpot: new Map(),
    coinGold: new Map(),
    coinSilver: new Map(),
  }
};

const el = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  goldUpdated: document.getElementById('goldUpdated'),
  silverUpdated: document.getElementById('silverUpdated'),
  coinUpdated: document.getElementById('coinUpdated'),
  goldKaratGrid: document.getElementById('goldKaratGrid'),
  goldRatesBody: document.getElementById('goldRatesBody'),
  silverRatesBody: document.getElementById('silverRatesBody'),
  goldFutureBox: document.getElementById('goldFutureBox'),
  goldSpotBox: document.getElementById('goldSpotBox'),
  silverFutureBox: document.getElementById('silverFutureBox'),
  silverSpotBox: document.getElementById('silverSpotBox'),
  coinGoldPanel: document.getElementById('coinGoldPanel'),
  coinSilverPanel: document.getElementById('coinSilverPanel'),
  navButtons: Array.from(document.querySelectorAll('.nav-btn')),
  pages: Array.from(document.querySelectorAll('.page')),
  coinSwitchButtons: Array.from(document.querySelectorAll('.switch-btn')),
};

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

function statusFrom(snapshot) {
  const g = !!snapshot?.meta?.gopnathConnected;
  const s = !!snapshot?.meta?.swayamConnected;
  const r = !!snapshot?.meta?.rightgoldConnected;
  const count = [g, s, r].filter(Boolean).length;
  if (count === 3) return { text: 'Live', cls: 'live' };
  if (count >= 1) return { text: 'Partial live', cls: 'warn' };
  return { text: 'Disconnected', cls: 'down' };
}

function setText(node, value) {
  if (!node) return;
  const next = String(value ?? '—');
  if (node.textContent !== next) node.textContent = next;
}

function setPage(page) {
  state.currentPage = page;
  el.pages.forEach((p) => p.classList.toggle('active', p.dataset.page === page));
  el.navButtons.forEach((b) => b.classList.toggle('active', b.dataset.page === page));
}

function setCoinTab(tab) {
  state.coinTab = tab;
  el.coinSwitchButtons.forEach((b) => b.classList.toggle('active', b.dataset.coinTab === tab));
  el.coinGoldPanel.classList.toggle('hidden', tab !== 'gold');
  el.coinSilverPanel.classList.toggle('hidden', tab !== 'silver');
}

function cardDir(current, previous) {
  const c = num(current);
  const p = num(previous);
  if (c === null || p === null || c === p) return '';
  return c > p ? 'up' : 'down';
}

function rowKey(row) {
  return String(row?.name || row?.label || '').trim().toLowerCase();
}

function buildTableHead(columns) {
  return `<thead><tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
}

function ensureTable(container, columns, cls) {
  let table = container.querySelector('table');
  if (!table) {
    table = document.createElement('table');
    table.className = cls;
    table.innerHTML = buildTableHead(columns) + '<tbody></tbody>';
    container.innerHTML = '';
    container.appendChild(table);
  }
  return table;
}

function patchTable(container, rows, columns, opts = {}) {
  const { key = rowKey, rowClass = '', cells = [] } = opts;
  const table = ensureTable(container, columns, opts.tableClass || 'rate-table');
  const tbody = table.tBodies[0];
  const existing = new Map(Array.from(tbody.children).map((tr) => [tr.dataset.key, tr]));
  const nextRows = [];

  rows.forEach((row) => {
    const k = key(row);
    let tr = existing.get(k);
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.key = k;
      tr.innerHTML = columns.map(() => '<td></td>').join('');
    }
    if (rowClass) tr.className = rowClass;
    cells.forEach((fn, idx) => {
      const td = tr.children[idx];
      if (td && typeof fn === 'function') fn(td, row, tr);
    });
    nextRows.push(tr);
    existing.delete(k);
  });

  tbody.replaceChildren(...nextRows);
}

function renderKaratGrid(cards) {
  const rows = cards || [];
  const existing = new Map(Array.from(el.goldKaratGrid.querySelectorAll('.karat-card')).map((n) => [n.dataset.key, n]));
  const next = [];

  rows.forEach((card) => {
    const key = String(card.label);
    let node = existing.get(key);
    if (!node) {
      node = document.createElement('article');
      node.className = 'karat-card';
      node.dataset.key = key;
      node.innerHTML = `
        <div class="karat-label"><span class="karat-name"></span><span class="karat-note"></span></div>
        <div class="karat-price"></div>
        <div class="karat-foot"><span>LIVE RATE</span><span class="hl"></span></div>
      `;
    }
    const prev = state.prev.goldKarat.get(key) || {};
    node.querySelector('.karat-name').textContent = card.label;
    node.querySelector('.karat-note').textContent = card.note || '';
    const price = node.querySelector('.karat-price');
    price.textContent = fmt(card.rate);
    price.classList.remove('value-up', 'value-down');
    const dir = cardDir(card.rate, prev.rate);
    if (dir === 'up') price.classList.add('value-up');
    if (dir === 'down') price.classList.add('value-down');
    node.querySelector('.hl').textContent = `${fmt(card.high)} | ${fmt(card.low)}`;
    next.push(node);
    existing.delete(key);
    state.prev.goldKarat.set(key, { rate: card.rate, high: card.high, low: card.low });
  });

  el.goldKaratGrid.replaceChildren(...next);
}

function renderMiniSeries(container, series, cacheMap, titleClass) {
  const items = series || [];
  if (!items.length) {
    container.innerHTML = `<div class="mini-rate"><div><div class="mini-title">No data</div><div class="mini-meta">Waiting for feed</div></div><div class="mini-price">—</div></div>`;
    return;
  }

  const existing = new Map(Array.from(container.querySelectorAll('.mini-rate')).map((n) => [n.dataset.key, n]));
  const next = [];

  items.forEach((item) => {
    const key = String(item.name || '').toLowerCase();
    let node = existing.get(key);
    if (!node) {
      node = document.createElement('div');
      node.className = 'mini-rate';
      node.dataset.key = key;
      node.innerHTML = `
        <div>
          <div class="mini-title"></div>
          <div class="mini-meta"></div>
        </div>
        <div class="mini-price"></div>
      `;
    }
    const prev = cacheMap.get(key) || {};
    node.querySelector('.mini-title').textContent = item.name;
    node.querySelector('.mini-meta').textContent = item.high !== null && item.low !== null ? `${fmt(item.high)} | ${fmt(item.low)}` : '';
    const price = node.querySelector('.mini-price');
    price.textContent = fmt(item.price ?? item.sell ?? item.buy);
    price.classList.remove('chip-up', 'chip-down');
    const dir = cardDir(item.price ?? item.sell ?? item.buy, prev.price ?? prev.sell ?? prev.buy);
    if (dir === 'up') price.classList.add('chip-up');
    if (dir === 'down') price.classList.add('chip-down');
    next.push(node);
    existing.delete(key);
    cacheMap.set(key, {
      price: item.price ?? item.sell ?? item.buy,
      high: item.high,
      low: item.low,
    });
  });

  container.replaceChildren(...next);
}

function renderCoinTable(container, rows, cacheMap) {
  const data = rows || [];
  if (!data.length) {
    container.innerHTML = '<div class="mini-rate"><div><div class="mini-title">No coin data</div><div class="mini-meta">Waiting for feed</div></div><div class="mini-price">—</div></div>';
    return;
  }

  const existing = new Map(Array.from(container.querySelectorAll('.coin-table tbody tr')).map((tr) => [tr.dataset.key, tr]));
  const nextRows = [];

  data.forEach((row) => {
    const key = String(row.name || '').toLowerCase();
    let tr = existing.get(key);
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.key = key;
      tr.innerHTML = `
        <td class="coin-product"></td>
        <td class="coin-price"></td>
      `;
    }
    const prev = cacheMap.get(key) || {};
    tr.querySelector('.coin-product').textContent = row.name;
    const price = tr.querySelector('.coin-price');
    price.textContent = `₹ ${fmt(row.price)}`;
    price.classList.remove('chip-up', 'chip-down');
    const dir = cardDir(row.price, prev.price);
    if (dir === 'up') price.classList.add('chip-up');
    if (dir === 'down') price.classList.add('chip-down');
    nextRows.push(tr);
    existing.delete(key);
    cacheMap.set(key, { price: row.price });
  });

  let table = container.querySelector('table');
  if (!table) {
    table = document.createElement('table');
    table.className = 'coin-table';
    table.innerHTML = `<thead><tr><th>PRODUCT</th><th>PRICE</th></tr></thead><tbody></tbody>`;
    container.innerHTML = '';
    container.appendChild(table);
  }
  const tbody = table.tBodies[0];
  tbody.replaceChildren(...nextRows);
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;

  const status = statusFrom(snapshot);
  el.statusDot.className = `status-dot ${status.cls}`;
  setText(el.statusText, status.text);

  setText(el.goldUpdated, timeFmt(snapshot.meta?.updatedAt));
  setText(el.silverUpdated, timeFmt(snapshot.meta?.updatedAt));
  setText(el.coinUpdated, timeFmt(snapshot.meta?.updatedAt));

  renderKaratGrid(snapshot.gold?.karats || []);

  patchTable(el.goldRatesBody, snapshot.gold?.rates || [], ['PRODUCT', 'BUY', 'SELL', 'HIGH', 'LOW'], {
    tableClass: 'rate-table',
    cells: [
      (td, row) => { td.className = 'rate-name'; td.textContent = row.name; },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.goldRates.get(key) || {};
        const dir = cardDir(row.buy, prev.buy);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.buy);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.goldRates.get(key) || {};
        const dir = cardDir(row.sell, prev.sell);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.sell);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.goldRates.get(key) || {};
        const dir = cardDir(row.high, prev.high);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.high);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.goldRates.get(key) || {};
        const dir = cardDir(row.low, prev.low);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.low);
        state.prev.goldRates.set(key, { buy: row.buy, sell: row.sell, high: row.high, low: row.low });
      },
    ],
  });

  patchTable(el.silverRatesBody, snapshot.silver?.rates || [], ['PRODUCT', 'BUY', 'SELL', 'HIGH', 'LOW'], {
    tableClass: 'rate-table',
    cells: [
      (td, row) => { td.className = 'rate-name'; td.textContent = row.name; },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.silverRates.get(key) || {};
        const dir = cardDir(row.buy, prev.buy);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.buy);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.silverRates.get(key) || {};
        const dir = cardDir(row.sell, prev.sell);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.sell);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.silverRates.get(key) || {};
        const dir = cardDir(row.high, prev.high);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.high);
      },
      (td, row) => {
        const key = rowKey(row);
        const prev = state.prev.silverRates.get(key) || {};
        const dir = cardDir(row.low, prev.low);
        td.className = `rate-num ${dir === 'up' ? 'chip-up' : dir === 'down' ? 'chip-down' : ''}`;
        td.textContent = fmt(row.low);
        state.prev.silverRates.set(key, { buy: row.buy, sell: row.sell, high: row.high, low: row.low });
      },
    ],
  });

  renderMiniSeries(el.goldFutureBox, snapshot.gold?.future || [], state.prev.goldFuture);
  renderMiniSeries(el.goldSpotBox, snapshot.gold?.spot || [], state.prev.goldSpot);
  renderMiniSeries(el.silverFutureBox, snapshot.silver?.future || [], state.prev.silverFuture);
  renderMiniSeries(el.silverSpotBox, snapshot.silver?.spot || [], state.prev.silverSpot);

  renderCoinTable(el.coinGoldPanel, snapshot.coins?.gold || [], state.prev.coinGold);
  renderCoinTable(el.coinSilverPanel, snapshot.coins?.silver || [], state.prev.coinSilver);
}

function scheduleRender(snapshot) {
  state.snapshot = snapshot;
  if (state.pendingRender) return;
  state.pendingRender = true;
  requestAnimationFrame(() => {
    state.pendingRender = false;
    renderSnapshot(state.snapshot);
  });
}

el.navButtons.forEach((btn) => {
  btn.addEventListener('click', () => setPage(btn.dataset.page));
});

el.coinSwitchButtons.forEach((btn) => {
  btn.addEventListener('click', () => setCoinTab(btn.dataset.coinTab));
});

socket.on('connect', () => {
  const current = state.snapshot;
  if (current) scheduleRender(current);
});

socket.on('snapshot', (snapshot) => {
  scheduleRender(snapshot);
});

socket.on('disconnect', () => {
  el.statusDot.className = 'status-dot down';
  setText(el.statusText, 'Disconnected');
});

fetch('/api/snapshot')
  .then((res) => res.json())
  .then((snapshot) => scheduleRender(snapshot))
  .catch(() => {});

setPage('gold');
setCoinTab('gold');
