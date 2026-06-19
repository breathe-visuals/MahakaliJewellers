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
    map: {},
    products: [],
  },
  swayam: {
    connected: false,
    lastSeen: null,
    live: [],
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

/* ── Feed handler (unchanged from Reference) ── */
function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live = items;
    state[sourceKey].map = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].products = visibleProducts(data.Rate, sourceKey);
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

/* ── Payload builder (unchanged from Reference) ── */
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

/* ── API route ── */
app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

/* ── Emit snapshot to each new client ── */
io.on('connection', (socket) => {
  socket.emit('rates:update', buildPayload());
});

httpServer.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on http://localhost:${PORT}`);
});
