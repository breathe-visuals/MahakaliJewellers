
const socket = io({ transports: ['websocket', 'polling'] });

const dom = {
  status: document.getElementById('status'),
  lastUpdated: document.getElementById('lastUpdated'),
  updatedBadges: Array.from(document.querySelectorAll('[data-connected]')),
  goldBase: document.getElementById('goldBaseBox'),
  goldKarat: document.getElementById('goldKaratBox'),
  silverProducts: document.getElementById('silverProductsBox'),
  futureBox: document.getElementById('futureBox'),
  spotBox: document.getElementById('spotBox'),
  coinBox: document.getElementById('coinBox'),
  slider: document.getElementById('rateSlider'),
  dots: Array.from(document.querySelectorAll('.dot')),
};

const prev = {
  goldRows: {},
  silverRows: {},
  futureRows: {},
  spotRows: {},
  coinRows: {},
};

const highlights = {};

function toNum(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(val) {
  const n = toNum(val);
  if (n === null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemKey(row) {
  return String(row?.symbol || row?.name || '').toLowerCase();
}

function rowToPlain(row) {
  return {
    symbol: String(row?.symbol || '').toLowerCase(),
    name: row?.name || '',
    bid: toNum(row?.bid),
    ask: toNum(row?.ask),
    high: toNum(row?.high),
    low: toNum(row?.low),
  };
}

function dirClass(cur, prv, key) {
  const c = toNum(cur), p = toNum(prv);
  const now = Date.now();
  if (c !== null && p !== null) {
    if (c > p) highlights[key] = { dir: 'up', expiresAt: now + 2500 };
    else if (c < p) highlights[key] = { dir: 'down', expiresAt: now + 2500 };
  }
  const h = highlights[key];
  return (h && now < h.expiresAt) ? h.dir : 'same';
}

function updateCell(el, current, previous, key, defaultClass = '') {
  if (!el) return;
  const chip = el.querySelector('.chip-val');
  if (!chip) return;
  const currentFmt = fmt(current);
  if (chip.textContent !== currentFmt) chip.textContent = currentFmt;
  const newClass = defaultClass ? `chip-val ${defaultClass}` : `chip-val ${dirClass(current, previous, key)}`;
  if (chip.className !== newClass) chip.className = newClass;
}

function buildTableHTML(rows, prevMap, options = {}) {
  const titleCol = options.titleCol || 'Name';
  const rowsHtml = (rows || []).map((row) => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const k = itemKey(cur);

    const bidCls = dirClass(cur.bid, prv.bid, `${k}-bid`);
    const askCls = dirClass(cur.ask, prv.ask, `${k}-ask`);

    return `
      <tr data-key="${escapeHtml(k)}">
        <td class="rowhead">${escapeHtml(cur.name || cur.symbol.toUpperCase())}</td>
        <td><span class="chip-val ${bidCls}">${fmt(cur.bid)}</span></td>
        <td><span class="chip-val ${askCls}">${fmt(cur.ask)}</span></td>
        <td><span class="chip-val always-green">${fmt(cur.high)}</span></td>
        <td><span class="chip-val always-red">${fmt(cur.low)}</span></td>
      </tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(titleCol)}</th>
          <th>Buy</th>
          <th>Sell</th>
          <th>High</th>
          <th>Low</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

function renderTable(container, rows, prevMap, options = {}) {
  if (!container) return;
  if (!rows || !rows.length) {
    container.innerHTML = '<p class="empty-msg">No live data yet.</p>';
    return;
  }

  let table = container.querySelector('table');
  let tbody = table ? table.querySelector('tbody') : null;
  let trs = tbody ? tbody.querySelectorAll('tr') : null;
  let rebuild = false;

  if (!table || !trs || trs.length !== rows.length) {
    rebuild = true;
  } else {
    for (let i = 0; i < rows.length; i++) {
      if (trs[i].getAttribute('data-key') !== itemKey(rows[i])) {
        rebuild = true;
        break;
      }
    }
  }

  if (rebuild) {
    container.innerHTML = buildTableHTML(rows, prevMap, options);
    return;
  }

  rows.forEach((row, i) => {
    const cur = rowToPlain(row);
    const prv = prevMap[itemKey(cur)] || {};
    const tr = trs[i];
    if (!tr) return;
    updateCell(tr.children[1], cur.bid, prv.bid, `${itemKey(cur)}-bid`);
    updateCell(tr.children[2], cur.ask, prv.ask, `${itemKey(cur)}-ask`);
    updateCell(tr.children[3], cur.high, null, null, 'always-green');
    updateCell(tr.children[4], cur.low, null, null, 'always-red');
  });
}

function updatePrev(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const k = itemKey(r);
    if (k) map[k] = rowToPlain(r);
  });
  return map;
}

function setStatus(state) {
  if (!dom.status) return;
  dom.status.className = `status-dot ${state}`;
  dom.status.title = state === 'live' ? 'Connected' : state === 'connecting' ? 'Connecting' : 'Disconnected';
}

function setConnectionBadges(connected) {
  dom.updatedBadges.forEach((badge) => {
    const key = badge.getAttribute('data-connected');
    const live = !!connected?.[key];
    badge.textContent = live ? 'Live' : 'Offline';
    badge.classList.toggle('live', live);
    badge.classList.toggle('offline', !live);
  });
}

function renderAll(data) {
  renderTable(dom.goldBase, data?.goldBase ? [data.goldBase] : [], {}, { titleCol: 'Master Gold' });
  renderTable(dom.goldKarat, data?.goldRows, prev.goldRows, { titleCol: 'Karat' });
  renderTable(dom.silverProducts, data?.silverRows, prev.silverRows, { titleCol: 'Silver Products' });
  renderTable(dom.futureBox, data?.futureRows, prev.futureRows, { titleCol: 'Market' });
  renderTable(dom.spotBox, data?.spotRows, prev.spotRows, { titleCol: 'Spot' });
  renderTable(dom.coinBox, data?.coinRows, prev.coinRows, { titleCol: 'Coin' });

  prev.goldRows = updatePrev(data?.goldRows);
  prev.silverRows = updatePrev(data?.silverRows);
  prev.futureRows = updatePrev(data?.futureRows);
  prev.spotRows = updatePrev(data?.spotRows);
  prev.coinRows = updatePrev(data?.coinRows);

  const ts = data?.updatedAt ? new Date(data.updatedAt) : null;
  if (dom.lastUpdated) {
    dom.lastUpdated.textContent = ts
      ? ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';
  }

  setConnectionBadges(data?.connected);
  const live = data?.connected?.gopnath || data?.connected?.swayam || data?.connected?.rightgold;
  setStatus(live ? 'live' : 'connecting');
}

socket.on('connect', () => setStatus('live'));
socket.on('disconnect', () => setStatus('disconnected'));
socket.on('connect_error', () => setStatus('disconnected'));
socket.on('rates:update', renderAll);

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
      const cards = Array.from(track.querySelectorAll('.slider-card'));
      const scrollLeft = track.scrollLeft;
      let closest = 0;
      let minDist = Infinity;
      cards.forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft - scrollLeft);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });
      updateDots(closest);
    }, 50);
  }, { passive: true });
})();
