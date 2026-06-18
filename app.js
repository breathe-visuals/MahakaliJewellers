const socket = io({ transports: ['websocket', 'polling'] });

const refs = {
  connectionPill: document.getElementById('connectionPill'),
  updatedText: document.getElementById('updatedText'),
  pages: Array.from(document.querySelectorAll('.page')),
  navButtons: Array.from(document.querySelectorAll('[data-page-btn]')),
  coinButtons: Array.from(document.querySelectorAll('[data-coin-tab]')),
  coinTitle: document.getElementById('coinTitle'),
  goldKaratGrid: document.getElementById('goldKaratGrid'),
  goldRefTable: document.getElementById('goldRefTable'),
  silverStack: document.getElementById('silverStack'),
  coinList: document.getElementById('coinList')
};

const state = {
  page: 'gold',
  coinTab: 'gold',
  data: null,
  renderQueued: false,
  cash: {
    goldKarat: new Map(),
    goldRef: new Map(),
    silverStack: new Map(),
    coinItems: new Map()
  }
};

function formatNumber(value) {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
}

function setText(el, value) {
  if (!el) return;
  const next = String(value ?? '—');
  if (el.textContent !== next) el.textContent = next;
}

function pageLabel(page) {
  return page.charAt(0).toUpperCase() + page.slice(1);
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function setPage(page) {
  if (state.page === page) return;
  state.page = page;
  scheduleRender();
}

function setCoinTab(tab) {
  if (state.coinTab === tab) return;
  state.coinTab = tab;
  scheduleRender();
}

function connectPill(connected) {
  const el = refs.connectionPill;
  if (!el) return;
  el.classList.remove('pill-ok', 'pill-warn', 'pill-bad');
  if (connected) {
    el.classList.add('pill-ok');
    el.textContent = 'Live';
  } else {
    el.classList.add('pill-warn');
    el.textContent = 'Connecting…';
  }
}

function activePageClass(page) {
  refs.pages.forEach((section) => {
    section.classList.toggle('active', section.dataset.page === page);
  });
  refs.navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.pageBtn === page);
  });
}

function activeCoinClass(tab) {
  refs.coinButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.coinTab === tab);
  });
}

function createCard(title, price, high, low, footLeft, footRight) {
  const card = document.createElement('div');
  card.className = 'karat-card';

  const top = document.createElement('div');
  top.className = 'karat-title';
  top.textContent = title;

  const center = document.createElement('div');
  center.className = 'karat-price';
  center.textContent = price;

  const foot = document.createElement('div');
  foot.className = 'karat-foot';

  const footText = document.createElement('div');
  footText.innerHTML = `<span class="tag light">${footLeft}</span>`;

  const highlow = document.createElement('div');
  highlow.className = 'karat-highlow';
  highlow.innerHTML = `
    <span class="tag green" data-role="high">${high}</span>
    <span class="tag light" data-role="low">${low}</span>
  `;

  foot.append(footText, highlow);
  card.append(top, center, foot);
  return card;
}

function createRowStack(title, price, high, low) {
  const wrap = document.createElement('div');
  wrap.className = 'row-stack';

  const t = document.createElement('div');
  t.className = 'row-stack-title';
  t.textContent = title;

  const body = document.createElement('div');
  body.className = 'row-stack-body';

  const p = document.createElement('div');
  p.className = 'row-stack-price';
  p.textContent = price;

  const hi = document.createElement('span');
  hi.className = 'tag green';
  hi.dataset.role = 'high';
  hi.textContent = high;

  const lo = document.createElement('span');
  lo.className = 'tag light';
  lo.dataset.role = 'low';
  lo.textContent = low;

  const hiLo = document.createElement('div');
  hiLo.className = 'row-stack-foot';
  hiLo.append(hi, lo);

  body.append(p);
  wrap.append(t, body, hiLo);
  return wrap;
}

function createSilverItem(title, price, high, low) {
  const item = document.createElement('div');
  item.className = 'silver-item';

  const left = document.createElement('div');
  left.style.minWidth = '0';

  const label = document.createElement('div');
  label.className = 'silver-label';
  label.textContent = title;

  const foot = document.createElement('div');
  foot.className = 'silver-foot';
  foot.innerHTML = `
    <span><span class="tag green" data-role="high">${high}</span></span>
    <span><span class="tag light" data-role="low">${low}</span></span>
  `;

  left.append(label, foot);

  const right = document.createElement('div');
  right.className = 'silver-price';
  right.textContent = price;

  item.append(left, right);
  return item;
}

function createCoinItem(title, price, high, low) {
  const item = document.createElement('div');
  item.className = 'coin-item';

  const name = document.createElement('div');
  name.className = 'coin-name';
  name.textContent = title;

  const priceWrap = document.createElement('div');
  priceWrap.className = 'coin-price';
  priceWrap.innerHTML = `<span class="currency">₹</span><span class="value">${price}</span>`;

  const foot = document.createElement('div');
  foot.className = 'coin-foot';
  foot.innerHTML = `
    <span>HIGH <span class="tag green" data-role="high">${high}</span></span>
    <span>LOW <span class="tag light" data-role="low">${low}</span></span>
  `;

  item.append(name, priceWrap, foot);
  return item;
}

function ensureList(container, source, items, factory, keyField = 'name') {
  const frag = document.createDocumentFragment();
  const map = state.cash[source];

  const existing = new Map(Array.from(container.children).map((node) => [node.dataset.key, node]));

  items.forEach((item) => {
    const key = String(item[keyField] || item.name || '').toLowerCase();
    let node = existing.get(key);
    if (!node) {
      node = factory(
        item.name,
        formatNumber(item.sell ?? item.buy),
        formatNumber(item.high),
        formatNumber(item.low)
      );
      node.dataset.key = key;
    } else {
      const priceNode = node.querySelector('.karat-price, .row-stack-price, .silver-price, .coin-price .value');
      const highNode = node.querySelector('[data-role="high"]');
      const lowNode = node.querySelector('[data-role="low"]');

      const price = formatNumber(item.sell ?? item.buy);
      if (priceNode && priceNode.textContent !== price) priceNode.textContent = price;

      const high = formatNumber(item.high);
      const low = formatNumber(item.low);
      if (highNode && highNode.textContent !== high) highNode.textContent = high;
      if (lowNode && lowNode.textContent !== low) lowNode.textContent = low;
    }
    frag.append(node);
    map.set(key, item);
    existing.delete(key);
  });

  container.replaceChildren(frag);
}

function findByName(rows, query) {
  const needle = String(query).toLowerCase();
  return rows.find((row) => String(row.name || '').toLowerCase().includes(needle)) || null;
}

function calcKarat(base, karat) {
  const baseSell = Number(base?.sell ?? base?.buy);
  const baseBuy = Number(base?.buy ?? base?.sell);
  const baseHigh = Number(base?.high ?? baseSell);
  const baseLow = Number(base?.low ?? baseSell);
  if (!Number.isFinite(baseSell) && !Number.isFinite(baseBuy)) {
    return { name: `${karat}K`, sell: null, buy: null, high: null, low: null };
  }
  const ratio = karat / 24;
  return {
    name: `${karat}K`,
    sell: Math.round((Number.isFinite(baseSell) ? baseSell : baseBuy) * ratio),
    buy: Math.round((Number.isFinite(baseBuy) ? baseBuy : baseSell) * ratio),
    high: Math.round((Number.isFinite(baseHigh) ? baseHigh : baseSell) * ratio),
    low: Math.round((Number.isFinite(baseLow) ? baseLow : baseSell) * ratio)
  };
}

function render() {
  const data = state.data;
  const connected = !!(data && (data.connected.gopnath || data.connected.swayam || data.connected.rightgold));
  connectPill(connected);

  if (data?.updatedAt) {
    setText(refs.updatedText, `Last updated ${new Date(data.updatedAt).toLocaleTimeString('en-IN')}`);
  }

  activePageClass(state.page);
  activeCoinClass(state.coinTab);

  if (!data) return;

  const goldBase = data.gold?.base || {};
  const goldRows = data.gold?.rows || [];
  const silverRows = data.silver?.rows || [];
  const coinGold = data.coin?.gold || [];
  const coinSilver = data.coin?.silver || [];

  const karats = [24, 22, 21, 20, 18, 14, 10, 9].map((k) => calcKarat(goldBase, k));
  ensureList(refs.goldKaratGrid, 'goldKarat', karats, (title, price, high, low) => createCard(title, price, high, low, 'LIVERATE', 'high | low'));

  ensureList(refs.goldRefTable, 'goldRef', goldRows, (title, price, high, low) => createRowStack(title, price, high, low));

  ensureList(refs.silverStack, 'silverStack', silverRows, (title, price, high, low) => createSilverItem(title, price, high, low));

  const coinItems = state.coinTab === 'gold' ? coinGold : coinSilver;
  const coinTitle = state.coinTab === 'gold' ? 'Gold Coin' : 'Silver Coin';
  setText(refs.coinTitle, coinTitle);
  ensureList(refs.coinList, 'coinItems', coinItems, (title, price, high, low) => createCoinItem(title, price, high, low));
}

function bindUI() {
  refs.navButtons.forEach((btn) => {
    btn.addEventListener('click', () => setPage(btn.dataset.pageBtn));
  });

  refs.coinButtons.forEach((btn) => {
    btn.addEventListener('click', () => setCoinTab(btn.dataset.coinTab));
  });

  // Swipe between pages and coin tabs, but keep it lightweight.
  let touchStartX = 0;
  let touchStartY = 0;
  let touching = false;

  window.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches[0]) return;
    touching = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (!touching) return;
    touching = false;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)) return;

    if (state.page === 'coin') {
      if (dx < 0) setCoinTab('silver');
      else setCoinTab('gold');
      return;
    }

    const order = ['gold', 'silver', 'coin'];
    const idx = order.indexOf(state.page);
    const next = dx < 0 ? order[Math.min(order.length - 1, idx + 1)] : order[Math.max(0, idx - 1)];
    setPage(next);
  }, { passive: true });
}

socket.on('connect', () => {
  connectPill(true);
  socket.emit('ping-state');
});

socket.on('disconnect', () => {
  connectPill(false);
});

socket.on('state', (payload) => {
  state.data = payload;
  scheduleRender();
});

bindUI();
scheduleRender();
