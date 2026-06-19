const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

/* ── Feed configuration (unchanged from Reference) ── */
const FEEDS = {
  gopnath: {
    url: 'https://starlinesupport.in:10001',
    room: 'gopnathrefinery',
  },
  swayam: {
    url: 'https://starlinesolutions.in:10001',
    room: 'swayamtrading',
  },
};

/* ── Server-side state ── */
const state = {
  gopnath: {
    connected: false,
    lastSeen: null,
    live: [],
    rawRate: [],   /* full unfiltered Rate array with original field names */
    map: {},
    products: [],
  },
  swayam: {
    connected: false,
    lastSeen: null,
    live: [],
    rawRate: [],   /* full unfiltered Rate array with original field names */
    map: {},
    products: [],
  },
};

/* ── Utility functions (unchanged from Reference) ── */
function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeed(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.Rate)) return data.Rate;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? '')
    .trim()
    .toLowerCase();
}

function labelOf(symbol, item) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'gold') return 'Gold';
  if (sym === 'silver') return 'Silver';
  if (sym === 'goldnext') return 'Gold Next';
  if (sym === 'silvernext') return 'Silver Next';
  if (sym === 'xauusd') return 'XAU/USD';
  if (sym === 'xagusd') return 'XAG/USD';
  if (sym === 'inrspot') return 'INR Spot';
  if (item?.Name) return String(item.Name).toUpperCase();
  return String(symbol || '').toUpperCase();
}

function indexBySymbol(items) {
  const map = {};
  for (const item of items) {
    const sym = symbolOf(item);
    if (!sym) continue;
    if (!map[sym]) map[sym] = item;
  }
  return map;
}

function standardizeItem(item, sourceKey) {
  if (!item) return null;
  const symbol = symbolOf(item);
  return {
    symbol,
    name: item.Name || item.Symbol_Name || item.Symbol || labelOf(symbol, item),
    bid: toNum(item.Bid ?? item.Buy),
    ask: toNum(item.Ask ?? item.Sell),
    high: toNum(item.High),
    low: toNum(item.Low),
    open: toNum(item.Open),
    close: toNum(item.Close),
    diff: toNum(item.Difference),
    ltp: toNum(item.LTP),
    time: item.Time || null,
    source: sourceKey,
  };
}

function visibleProducts(rows, sourceKey) {
  return rows
    .filter((row) => String(row?.IsDisplay).toLowerCase() === 'true')
    .map((row) => standardizeItem(row, sourceKey))
    .filter(Boolean);
}

/* Search full raw Rate array by Name field (case-insensitive, ignores IsDisplay) */
function findRawByName(rows, name) {
  if (!Array.isArray(rows)) return null;
  const target = String(name).trim().toLowerCase();
  return rows.find(r => String(r?.Name ?? '').trim().toLowerCase() === target) || null;
}

/* ── Feed handler ── */
function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live = items;
    state[sourceKey].map  = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    /* Store the raw Rate array with original field names (Name, Bid, Buy, IsDisplay…) */
    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].rawRate   = data.Rate;
      state[sourceKey].products  = visibleProducts(data.Rate, sourceKey);
    } else if (Array.isArray(data)) {
      /* Feed sent a plain array — use it as rawRate too */
      state[sourceKey].rawRate = data;
    }

    publish();
  } catch (err) {
    console.log(`[${sourceKey}] parse error:`, err.message);
  }
}

/* ── Feed connection (unchanged from Reference) ── */
function connectFeed(sourceKey) {
  const feed = FEEDS[sourceKey];
  const socket = createClient(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    rejectUnauthorized: false,
  });

  socket.on('connect', () => {
    state[sourceKey].connected = true;
    socket.emit('room', feed.room);
    socket.emit('Client', feed.room);
    publish();
  });

  socket.on('disconnect', () => {
    state[sourceKey].connected = false;
    publish();
  });

  socket.on('connect_error', (err) => {
    state[sourceKey].connected = false;
    console.log(`[${sourceKey}] connect_error:`, err.message);
    publish();
  });

  socket.on('ClientData', (data) => {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      state[sourceKey].clientData = parsed;
    } catch {
      // ignore
    }
  });

  socket.on('message', (data) => handleFeed(sourceKey, data));
  socket.on('Liverate', (data) => handleFeed(sourceKey, data));

  return socket;
}

/* ── Symbol routing (unchanged from Reference) ── */
function chooseRaw(symbol) {
  const sym = String(symbol || '').toLowerCase();

  if (sym === 'gold') {
    return state.gopnath.map.gold || state.swayam.map.gold || null;
  }

  if (sym === 'silver') {
    return state.swayam.map.silver || state.gopnath.map.silver || null;
  }

  return state.swayam.map[sym] || state.gopnath.map[sym] || null;
}

function sourceFor(symbol) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'silver' || sym === 'silvernext') return 'swayam';
  return state.gopnath.map[sym] ? 'gopnath' : 'swayam';
}

function buildRows(symbols) {
  return symbols
    .map((sym) => {
      const raw = chooseRaw(sym);
      if (!raw) return null;
      return standardizeItem(raw, sourceFor(sym));
    })
    .filter(Boolean);
}

/* ── Base-rate finders for karat/coin calculations ── */
/*
  Gold base  = "999 IMP RTGS"    row from Gold Products  → ASK (Sell) price
  Silver base = "SILVER PETI RTGS" row from Silver Products → ASK (Sell) price

  Both rows are IsDisplay=true (shown in the product tables), so we search
  state.*.products (already standardized, .ask field = Sell) first.
  rawRate is kept as a safety fallback using Ask ?? Sell fields.
*/

function getGoldBase() {
  /* Strategy 1 – visible Gold Products (standardized): .ask = Sell */
  const p = state.gopnath.products.find(
    p => String(p?.name ?? '').trim().toLowerCase() === '999 imp rtgs'
  );
  if (p != null && p.ask != null) return toNum(p.ask);

  /* Strategy 2 – raw Rate array: Ask ?? Sell field */
  const r = findRawByName(state.gopnath.rawRate, '999 IMP RTGS')
         || findRawByName(state.gopnath.live,    '999 IMP RTGS');
  if (r) return toNum(r.Ask ?? r.Sell);

  return null;
}

function getSilverBase() {
  /* Strategy 1 – visible Silver Products (standardized): .ask = Sell */
  const p = state.swayam.products.find(
    p => String(p?.name ?? '').trim().toLowerCase() === 'silver peti rtgs'
  );
  if (p != null && p.ask != null) return toNum(p.ask);

  /* Strategy 2 – raw Rate array: Ask ?? Sell field */
  const r = findRawByName(state.swayam.rawRate, 'SILVER PETI RTGS')
         || findRawByName(state.swayam.live,    'SILVER PETI RTGS');
  if (r) return toNum(r.Ask ?? r.Sell);

  /* Strategy 3 – fuzzy: any row whose name contains 'peti', Sell price */
  const fuzzy = [...state.swayam.rawRate, ...state.swayam.live].find(
    r => String(r?.Name ?? r?.name ?? '').toLowerCase().includes('peti')
  );
  if (fuzzy) return toNum(fuzzy.Ask ?? fuzzy.Sell ?? fuzzy.ask);

  return null;
}


/* ── Payload builder ── */
function buildPayload() {
  return {
    updatedAt: state.swayam.lastSeen || state.gopnath.lastSeen || null,
    connected: {
      gopnath: state.gopnath.connected,
      swayam: state.swayam.connected,
    },
    summary: {
      gold: standardizeItem(chooseRaw('gold'), 'gopnath'),
      silver: standardizeItem(chooseRaw('silver'), 'swayam'),
    },
    goldProducts: state.gopnath.products,
    silverProducts: state.swayam.products,
    futureRows: buildRows(['gold', 'silver', 'goldnext', 'silvernext']),
    spotRows: buildRows(['xauusd', 'xagusd', 'inrspot']),
    /* Explicit base rates for karat/coin calculations (from full raw data, not just visible rows) */
    goldBase: getGoldBase(),
    silverBase: getSilverBase(),
  };
}

function publish() {
  io.emit('rates:update', buildPayload());
}

/* ── Start feeds ── */
connectFeed('gopnath');
connectFeed('swayam');

/* ── Static files served from public/ ── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── API routes ── */
app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

/* Debug: lists all product names from both feeds — use to confirm silver row name */
app.get('/api/debug', (req, res) => {
  const swayamNames = state.swayam.rawRate.map(r => ({
    name: r?.Name, bid: r?.Bid ?? r?.Buy, display: r?.IsDisplay,
  }));
  const gopnathNames = state.gopnath.rawRate.map(r => ({
    name: r?.Name, bid: r?.Bid ?? r?.Buy, display: r?.IsDisplay,
  }));
  res.json({
    goldBase:   getGoldBase(),
    silverBase: getSilverBase(),
    swayamRawCount:  state.swayam.rawRate.length,
    gopnathRawCount: state.gopnath.rawRate.length,
    swayam:  swayamNames,
    gopnath: gopnathNames,
  });
});

/* ── Emit snapshot to each new client ── */
io.on('connection', (socket) => {
  socket.emit('rates:update', buildPayload());
});

httpServer.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on http://localhost:${PORT}`);
});
