/* ================================================================
   MAHAKALI JEWELLERS – app.js
   Socket.IO client. All live logic preserved from Reference.
   Extended with: karat rates, coin rates, multi-page navigation.
   ================================================================ */

const socket = io({ transports: ['websocket', 'polling'] });

/* ── DOM refs ─────────────────────────────────────────── */
const dom = {
  status:            document.getElementById('status'),
  lastUpdated:       document.getElementById('lastUpdated'),
  futureBox:         document.getElementById('futureBox'),
  spotBox:           document.getElementById('spotBox'),
  goldProductsBox:   document.getElementById('goldProductsBox'),
  silverProductsBox: document.getElementById('silverProductsBox'),
  goldCoinBox:       document.getElementById('goldCoinBox'),
  silverCoinBox:     document.getElementById('silverCoinBox'),
  slider:            document.getElementById('rateSlider'),
  dots:              Array.from(document.querySelectorAll('.dot')),
};

/* ── Previous state for change detection ─────────────── */
const prev = {
  future:         {},
  spot:           {},
  goldProducts:   {},
  silverProducts: {},
  karatBase:      null,
  goldCoinBase:   null,
  silverCoinBase: null,
};

/* ── Highlight linger store ───────────────────────────── */
const highlights = {};

/* ── Utilities ────────────────────────────────────────── */
function toNum(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(val, decimals) {
  const n = toNum(val);
  if (n === null) return '—';
  if (decimals !== undefined) return n.toFixed(decimals);
  return String(n);
}

function fmtINR(val) {
  const n = toNum(val);
  if (n === null) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function escape(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function itemKey(row) {
  return String(row?.symbol || row?.name || '').toLowerCase();
}

function rowToPlain(row) {
  return {
    symbol: String(row?.symbol || '').toLowerCase(),
    name:   row?.name || '',
    bid:    toNum(row?.bid),
    ask:    toNum(row?.ask),
    high:   toNum(row?.high),
    low:    toNum(row?.low),
  };
}

function symbolLabel(sym, fallback) {
  const s = String(sym || '').toLowerCase();
  const map = {
    gold: 'Gold', silver: 'Silver',
    goldnext: 'Gold Next', silvernext: 'Silver Next',
    xauusd: 'XAU/USD', xagusd: 'XAG/USD', inrspot: 'INR Spot',
  };
  return map[s] || fallback || s.toUpperCase();
}

/* ── Change-class with 3-second linger ───────────────── */
function dirClass(cur, prv, key) {
  const c = toNum(cur), p = toNum(prv);
  const now = Date.now();

  if (c !== null && p !== null) {
    if (c > p) highlights[key] = { dir: 'up',   expiresAt: now + 3000 };
    else if (c < p) highlights[key] = { dir: 'down', expiresAt: now + 3000 };
  }

  const h = highlights[key];
  return (h && now < h.expiresAt) ? h.dir : 'same';
}

/* ── Table builders ───────────────────────────────────── */
function updateCell(el, current, previous, key, defaultClass = '') {
  if (!el) return;
  const chip = el.querySelector('.chip-val');
  if (!chip) return;

  const currentFmt = fmt(current);
  if (chip.textContent !== currentFmt) chip.textContent = currentFmt;

  const newClass = defaultClass
    ? `chip-val ${defaultClass}`
    : `chip-val ${dirClass(current, previous, key)}`;
  if (chip.className !== newClass) chip.className = newClass;
}

function buildTableHTML(rows, prevMap, colLabel) {
  const trs = rows.map(row => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const k   = itemKey(cur);

    const bidCls = dirClass(cur.bid, prv.bid, k + '-bid');
    const askCls = dirClass(cur.ask, prv.ask, k + '-ask');

    return `
      <tr data-key="${k}">
        <td class="rowhead">${escape(symbolLabel(cur.symbol, cur.name))}</td>
        <td class="cell-bid"><span class="chip-val ${bidCls}">${fmt(cur.bid)}</span></td>
        <td class="cell-ask"><span class="chip-val ${askCls}">${fmt(cur.ask)}</span></td>
        <td class="cell-high"><span class="chip-val always-green">${fmt(cur.high)}</span></td>
        <td class="cell-low"><span class="chip-val always-red">${fmt(cur.low)}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${escape(colLabel)}</th>
          <th>Buy</th><th>Sell</th>
          <th>High</th><th>Low</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>`;
}

function renderTable(container, rows, prevMap, type) {
  if (!rows || !rows.length) {
    container.innerHTML = '<p class="empty-msg">No data yet.</p>';
    return;
  }

  const colLabel = type === 'mini' ? 'Product' : 'Symbol';

  let table = container.querySelector('table');
  let tbody = table ? table.querySelector('tbody') : null;
  let trs   = tbody ? tbody.querySelectorAll('tr') : null;

  let rebuild = false;
  if (!table || !trs || trs.length !== rows.length) {
    rebuild = true;
  } else {
    for (let i = 0; i < rows.length; i++) {
      const cur = rowToPlain(rows[i]);
      if (trs[i].getAttribute('data-key') !== itemKey(cur)) { rebuild = true; break; }
    }
  }

  if (rebuild) {
    container.innerHTML = buildTableHTML(rows, prevMap, colLabel);
  } else {
    rows.forEach((row, i) => {
      const cur = rowToPlain(row);
      const prv = prevMap[itemKey(cur)] || {};
      const k   = itemKey(cur);
      const tr  = trs[i];

      updateCell(tr.querySelector('.cell-bid'),  cur.bid,  prv.bid,  k + '-bid');
      updateCell(tr.querySelector('.cell-ask'),  cur.ask,  prv.ask,  k + '-ask');
      updateCell(tr.querySelector('.cell-high'), cur.high, null, null, 'always-green');
      updateCell(tr.querySelector('.cell-low'),  cur.low,  null, null, 'always-red');
    });
  }
}

function updatePrevMap(rows) {
  const map = {};
  (rows || []).forEach(r => { const k = itemKey(r); if (k) map[k] = rowToPlain(r); });
  return map;
}

/* ── Karat rate renderer ──────────────────────────────── */
const KARAT_CONFIG = [
  { id: 'kp-24k', pct: 1.0000 },
  { id: 'kp-22k', pct: 0.9167 },
  { id: 'kp-21k', pct: 0.8750 },
  { id: 'kp-20k', pct: 0.8333 },
  { id: 'kp-18k', pct: 0.7500 },
  { id: 'kp-14k', pct: 0.5833 },
  { id: 'kp-9k',  pct: 0.3750 },
];

function renderKaratRates(goldBase) {
  const base = toNum(goldBase);

  KARAT_CONFIG.forEach(({ id, pct }) => {
    const el = document.getElementById(id);
    if (!el) return;

    const price    = base !== null ? Math.round(base * pct) : null;
    const prevBase = prev.karatBase;
    const prevPrice = prevBase !== null ? Math.round(prevBase * pct) : null;

    const newText = price !== null ? price.toLocaleString('en-IN') : '—';
    if (el.textContent !== newText) el.textContent = newText;

    if (price !== null && prevPrice !== null) {
      if (price > prevPrice)      el.className = 'karat-price up';
      else if (price < prevPrice) el.className = 'karat-price down';
      else                        el.className = 'karat-price';
    } else {
      el.className = 'karat-price';
    }
  });

  prev.karatBase = base;
}

/* ── Gold Coin renderer ───────────────────────────────── */
const GOLD_COINS = [
  { label: 'GOLD COIN 999 1 GM',   grams: 1,   premium: 1000  },
  { label: 'GOLD COIN 999 2 GM',   grams: 2,   premium: 2000  },
  { label: 'GOLD COIN 999 5 GM',   grams: 5,   premium: 5000  },
  { label: 'GOLD COIN 999 10 GM',  grams: 10,  premium: 1000  },
  { label: 'GOLD COIN 999 20 GM',  grams: 20,  premium: 2000  },
  { label: 'GOLD COIN 999 50 GM',  grams: 50,  premium: 5000  },
  { label: 'GOLD COIN 999 100 GM', grams: 100, premium: 10000 },
];

function renderGoldCoins(goldBase) {
  const container = dom.goldCoinBox;
  if (!container) return;

  const base10g = toNum(goldBase);
  const base1g  = base10g !== null ? base10g / 10 : null;

  const table = container.querySelector('.coin-table');
  const tbody = table ? table.querySelector('tbody') : null;

  if (!table || !tbody) {
    /* Build fresh */
    const rows = GOLD_COINS.map(c => {
      const price = base1g !== null ? Math.round(base1g * c.grams + c.premium) : null;
      const priceText = price !== null ? price.toLocaleString('en-IN') : '—';
      return `<tr data-coin="${escape(c.label)}">
        <td class="rowhead">${escape(c.label)}</td>
        <td><span class="coin-price" id="gc-${c.grams}g">${priceText}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="coin-table">
        <thead><tr><th>Product</th><th>Price (₹)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else {
    /* Incremental update */
    GOLD_COINS.forEach(c => {
      const el = container.querySelector(`#gc-${c.grams}g`);
      if (!el) return;
      const price    = base1g !== null ? Math.round(base1g * c.grams + c.premium) : null;
      const prevBase = prev.goldCoinBase;
      const prevPrice = prevBase !== null ? Math.round((prevBase / 10) * c.grams + c.premium) : null;

      const newText = price !== null ? price.toLocaleString('en-IN') : '—';
      if (el.textContent !== newText) el.textContent = newText;

      if (price !== null && prevPrice !== null) {
        if (price > prevPrice)      el.className = 'coin-price up';
        else if (price < prevPrice) el.className = 'coin-price down';
        else                        el.className = 'coin-price';
      }
    });
  }

  prev.goldCoinBase = base10g;
}

/* ── Silver Coin renderer ─────────────────────────────── */
const SILVER_COINS = [
  { label: 'SILVER COIN 999 10 GM',   grams: 10,   premium: 500  },
  { label: 'SILVER COIN 999 20 GM',   grams: 20,   premium: 1000 },
  { label: 'SILVER COIN 999 50 GM',   grams: 50,   premium: 1000 },
  { label: 'SILVER COIN 999 100 GM',  grams: 100,  premium: 1500 },
  { label: 'SILVER COIN 999 500 GM',  grams: 500,  premium: 2500 },
  { label: 'SILVER COIN 999 1 KG',    grams: 1000, premium: 5000 },
];

function renderSilverCoins(silverBase) {
  const container = dom.silverCoinBox;
  if (!container) return;

  const base1kg = toNum(silverBase);
  const base1g  = base1kg !== null ? base1kg / 1000 : null;

  const table = container.querySelector('.coin-table');
  const tbody = table ? table.querySelector('tbody') : null;

  if (!table || !tbody) {
    const rows = SILVER_COINS.map((c, i) => {
      const price = base1g !== null ? Math.round(base1g * c.grams + c.premium) : null;
      const priceText = price !== null ? price.toLocaleString('en-IN') : '—';
      return `<tr data-coin="${escape(c.label)}">
        <td class="rowhead">${escape(c.label)}</td>
        <td><span class="coin-price" id="sc-${i}">${priceText}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="coin-table">
        <thead><tr><th>Product</th><th>Price (₹)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else {
    SILVER_COINS.forEach((c, i) => {
      const el = container.querySelector(`#sc-${i}`);
      if (!el) return;
      const price    = base1g !== null ? Math.round(base1g * c.grams + c.premium) : null;
      const prevBase = prev.silverCoinBase;
      const prev1g   = prevBase !== null ? prevBase / 1000 : null;
      const prevPrice = prev1g !== null ? Math.round(prev1g * c.grams + c.premium) : null;

      const newText = price !== null ? price.toLocaleString('en-IN') : '—';
      if (el.textContent !== newText) el.textContent = newText;

      if (price !== null && prevPrice !== null) {
        if (price > prevPrice)      el.className = 'coin-price up';
        else if (price < prevPrice) el.className = 'coin-price down';
        else                        el.className = 'coin-price';
      }
    });
  }

  prev.silverCoinBase = base1kg;
}

/* ── Render all sections ──────────────────────────────── */
function renderAll(data) {
  /* Gold / silver product tables */
  renderTable(dom.goldProductsBox,   data?.goldProducts,   prev.goldProducts,   'mini');
  renderTable(dom.silverProductsBox, data?.silverProducts, prev.silverProducts, 'mini');

  /* Future & spot rate tables */
  renderTable(dom.futureBox, data?.futureRows, prev.future, 'rate');
  renderTable(dom.spotBox,   data?.spotRows,   prev.spot,   'rate');

  /* Karat rates */
  renderKaratRates(data?.goldBase);

  /* Coin rates */
  renderGoldCoins(data?.goldBase);
  renderSilverCoins(data?.silverBase);

  /* Advance previous-state */
  prev.goldProducts   = updatePrevMap(data?.goldProducts);
  prev.silverProducts = updatePrevMap(data?.silverProducts);
  prev.future         = updatePrevMap(data?.futureRows);
  prev.spot           = updatePrevMap(data?.spotRows);

  /* Timestamp */
  const ts = data?.updatedAt ? new Date(data.updatedAt) : null;
  if (dom.lastUpdated) {
    dom.lastUpdated.textContent = ts
      ? ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';
  }

  /* Connection status */
  const live = data?.connected?.gopnath || data?.connected?.swayam;
  setStatus(live ? 'live' : 'connecting');
}

/* ── Status indicator ─────────────────────────────────── */
function setStatus(state) {
  if (!dom.status) return;
  dom.status.className = 'status-dot ' + state;
  dom.status.title     = state === 'live' ? 'Connected – live' : 'Connecting…';
}

/* ── Socket events ────────────────────────────────────── */
socket.on('connect',       () => setStatus('live'));
socket.on('disconnect',    () => setStatus('disconnected'));
socket.on('connect_error', () => setStatus('disconnected'));
socket.on('rates:update',  renderAll);

/* ── Page navigation ──────────────────────────────────── */
const PAGES = ['gold', 'silver', 'coins'];

function switchPage(pageId) {
  PAGES.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.toggle('hidden', id !== pageId);

    /* Desktop nav */
    const dBtn = document.getElementById('dnav-' + id);
    if (dBtn) {
      dBtn.classList.toggle('active', id === pageId);
      dBtn.setAttribute('aria-pressed', id === pageId ? 'true' : 'false');
    }

    /* Bottom nav */
    const bBtn = document.getElementById('bnav-' + id);
    if (bBtn) bBtn.classList.toggle('active', id === pageId);
  });
}

/* ── Coin tab switching ───────────────────────────────── */
const COIN_PANELS = ['goldcoin', 'silvercoin'];

function switchCoinTab(tabId) {
  COIN_PANELS.forEach(id => {
    const panel = document.getElementById('panel-' + id);
    const tab   = document.getElementById('tab-' + id);
    if (panel) panel.classList.toggle('hidden', id !== tabId);
    if (tab) {
      tab.classList.toggle('active', id === tabId);
      tab.setAttribute('aria-selected', id === tabId ? 'true' : 'false');
    }
  });
}

/* ── Slider swipe / dot sync ──────────────────────────── */
(function initSlider() {
  const track = dom.slider;
  if (!track) return;

  function updateDots(index) {
    dom.dots.forEach((d, i) => d.classList.toggle('active', i === index));
  }

  dom.dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const cards = track.querySelectorAll('.slider-card');
      if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    });
  });

  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const cards      = Array.from(track.querySelectorAll('.slider-card'));
      const scrollLeft = track.scrollLeft;
      let closest = 0, minDist = Infinity;
      cards.forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft - scrollLeft);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      updateDots(closest);
    }, 50);
  }, { passive: true });
})();
