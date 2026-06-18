const socket = io();

const state = {
  snapshot: null,
  currentPage: 'gold',
  coinTab: 'gold',
  prev: {
    goldKarat: {},
    goldRates: {},
    silverRates: {},
    goldFuture: {},
    goldSpot: {},
    silverFuture: {},
    silverSpot: {},
    coinGold: {},
    coinSilver: {},
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
  if (n === null) return '—';
  return n.toLocaleString('en-IN');
}

function setText(node, value) {
  if (!node) return;
  const next = String(value ?? '—');
  if (node.textContent !== next) node.textContent = next;
}

function flash(node, dir) {
  if (!node) return;
  node.classList.remove('change-flash-up', 'change-flash-down');
  node.classList.remove('up', 'down');
  if (dir === 'up') {
    node.classList.add('up', 'change-flash-up');
    setTimeout(() => node.classList.remove('change-flash-up'), 560);
  } else if (dir === 'down') {
    node.classList.add('down', 'change-flash-down');
    setTimeout(() => node.classList.remove('change-flash-down'), 560);
  }
}

function compareCurPrev(cur, prev) {
  const c = num(cur);
  const p = num(prev);
  if (c === null || p === null || c === p) return '';
  return c > p ? 'up' : 'down';
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function renderKaratCards(cards) {
  const prevMap = state.prev.goldKarat;
  el.goldKaratGrid.innerHTML = cards.map((card) => {
    const prev = prevMap[card.label] || {};
    const dir = compareCurPrev(card.rate, prev.rate);
    return `
      <article class="karat-card">
        <div class="karat-label">
          <span>${card.label}</span>
          <span>${card.note}</span>
        </div>
        <div class="karat-price ${dir === 'up' ? 'value-up' : dir === 'down' ? 'value-down' : ''}">${fmt(card.rate)}</div>
        <div class="karat-foot">
          <span>LIVE RATE</span>
          <span class="hl">${fmt(card.high)} | ${fmt(card.low)}</span>
        </div>
      </article>
    `;
  }).join('');
  state.prev.goldKarat = Object.fromEntries(cards.map(c => [c.label, { ...c }]));
}

function renderTable(body, rows, prevKey, emptyText) {
  if (!rows || !rows.length) {
    body.innerHTML = `<tr><td colspan="5">${emptyText}</td></tr>`;
    return;
  }
  const prevMap = state.prev[prevKey] || {};
  body.innerHTML = rows.map((row) => {
    const prev = prevMap[row.name] || {};
    return `
      <tr>
        <td class="rate-name">${row.name}</td>
        <td class="rate-num">${fmt(row.buy)}</td>
        <td class="rate-num">${fmt(row.sell)}</td>
        <td class="rate-num">${fmt(row.high)}</td>
        <td class="rate-num">${fmt(row.low)}</td>
      </tr>
    `;
  }).join('');
  state.prev[prevKey] = Object.fromEntries(rows.map((r) => [r.name, { ...r }]));
}

function renderMini(container, rows, prevKey, title) {
  if (!rows || !rows.length) {
    container.innerHTML = `<div class="mini-rate"><span class="label">${title}</span><span class="numbers">Waiting for live feed…</span></div>`;
    return;
  }
  const prevMap = state.prev[prevKey] || {};
  container.innerHTML = rows.map((row) => {
    const prev = prevMap[row.name] || {};
    const current = row.price ?? row.sell ?? row.buy;
    const prevCurrent = prev.price ?? prev.sell ?? prev.buy;
    const dir = compareCurPrev(current, prevCurrent);
    return `
      <div class="mini-rate">
        <div class="label">${row.name}</div>
        <div class="numbers">
          <span class="main ${dir}">${fmt(current)}</span>
          <span>${fmt(row.high)} | ${fmt(row.low)}</span>
        </div>
      </div>
    `;
  }).join('');
  state.prev[prevKey] = Object.fromEntries(rows.map((r) => [r.name, { ...r }]));
}

function renderCoin(container, rows, prevKey) {
  if (!rows || !rows.length) {
    container.innerHTML = `<div class="coin-row"><span class="name">No live coin rates yet</span><span class="price">—</span></div>`;
    return;
  }
  const prevMap = state.prev[prevKey] || {};
  container.innerHTML = rows.map((row) => {
    const prev = prevMap[row.name] || {};
    const current = row.price ?? row.sell ?? row.buy;
    const prevCurrent = prev.price ?? prev.sell ?? prev.buy;
    const dir = compareCurPrev(current, prevCurrent);
    return `
      <div class="coin-row">
        <span class="name">${row.name}</span>
        <span class="price ${dir}">${fmt(current)}</span>
      </div>
    `;
  }).join('');
  state.prev[prevKey] = Object.fromEntries(rows.map((r) => [r.name, { ...r }]));
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;

  const live = snapshot?.meta?.goldConnected || snapshot?.meta?.silverConnected || snapshot?.meta?.coinConnected;
  el.statusDot.classList.remove('live', 'warn', 'down');
  if (live) {
    el.statusDot.classList.add('live');
    setText(el.statusText, 'Live');
  } else {
    el.statusDot.classList.add('warn');
    setText(el.statusText, 'Reconnecting…');
  }

  setText(el.goldUpdated, formatTime(snapshot?.meta?.gopnathUpdatedAt || snapshot?.meta?.updatedAt));
  setText(el.silverUpdated, formatTime(snapshot?.meta?.swayamUpdatedAt || snapshot?.meta?.updatedAt));
  setText(el.coinUpdated, formatTime(snapshot?.meta?.rightgoldUpdatedAt || snapshot?.meta?.updatedAt));

  renderKaratCards(snapshot?.gold?.karats || []);
  renderTable(el.goldRatesBody, snapshot?.gold?.rates || [], 'goldRates', 'No gold rates yet.');
  renderTable(el.silverRatesBody, snapshot?.silver?.products || [], 'silverRates', 'No silver rates yet.');
  renderMini(el.goldFutureBox, snapshot?.gold?.future || [], 'goldFuture', 'Gold Future');
  renderMini(el.goldSpotBox, snapshot?.gold?.spot || [], 'goldSpot', 'Gold Spot');
  renderMini(el.silverFutureBox, snapshot?.silver?.future || [], 'silverFuture', 'Silver Future');
  renderMini(el.silverSpotBox, snapshot?.silver?.spot || [], 'silverSpot', 'Silver Spot');
  renderCoin(el.coinGoldPanel, snapshot?.coins?.gold || [], 'coinGold');
  renderCoin(el.coinSilverPanel, snapshot?.coins?.silver || [], 'coinSilver');
  setCoinTab(state.coinTab);
}

let pending = null;
let scheduled = false;
function queueRender(snapshot) {
  pending = snapshot;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (!pending) return;
    renderSnapshot(pending);
    pending = null;
  });
}

socket.on('connect', () => {
  el.statusDot.classList.remove('warn', 'down');
  el.statusDot.classList.add('live');
  setText(el.statusText, 'Connected');
});

socket.on('disconnect', () => {
  el.statusDot.classList.remove('live');
  el.statusDot.classList.add('warn');
  setText(el.statusText, 'Offline');
});

socket.on('snapshot', queueRender);

el.navButtons.forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
el.coinSwitchButtons.forEach((btn) => btn.addEventListener('click', () => setCoinTab(btn.dataset.coinTab)));

setPage('gold');
setCoinTab('gold');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
