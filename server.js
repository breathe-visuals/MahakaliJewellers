const express  = require('express');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const { Server }    = require('socket.io');
const { io: createClient } = require('socket.io-client');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

/* ══════════════════════════════════════════════════════════════
   CONFIG — loaded once at startup from /config/*.json
   Future clients only need to edit those two files + /Media/*
   ══════════════════════════════════════════════════════════════ */
function loadConfig(filename) {
  const p = path.join(__dirname, 'config', filename);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[config] Cannot load ${filename}: ${err.message}`);
    process.exit(1);
  }
}

const siteConfig  = loadConfig('site-config.json');
const adminConfig = loadConfig('admin-config.json');

/* Config-driven base row names */
const GOLD_BASE_ROW   = adminConfig?.goldRates?.baseRow   || '999 IMP RTGS';
const GOLD_COIN_ROW   = adminConfig?.goldCoins?.baseRow   || '999 IMP RTGS';
const SILVER_COIN_ROW = adminConfig?.silverCoins?.baseRow || 'SILVER PETI RTGS';

/* ══════════════════════════════════════════════════════════════
   FEED CONFIGURATION  (unchanged from Reference)
   ══════════════════════════════════════════════════════════════ */
const FEEDS = {
  gopnath: { url: 'https://starlinesupport.in:10001',  room: 'gopnathrefinery' },
  swayam:  { url: 'https://starlinesolutions.in:10001', room: 'swayamtrading'   },
};

/* ══════════════════════════════════════════════════════════════
   SERVER STATE
   ══════════════════════════════════════════════════════════════ */
const state = {
  gopnath: { connected: false, lastSeen: null, live: [], rawRate: [], map: {}, products: [] },
  swayam:  { connected: false, lastSeen: null, live: [], rawRate: [], map: {}, products: [] },
};

/* ══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS  (unchanged from Reference)
   ══════════════════════════════════════════════════════════════ */
function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeed(data) {
  if (Array.isArray(data))              return data;
  if (data && Array.isArray(data.Rate)) return data.Rate;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? '').trim().toLowerCase();
}

function labelOf(symbol, item) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'gold')       return 'Gold';
  if (s === 'silver')     return 'Silver';
  if (s === 'goldnext')   return 'Gold Next';
  if (s === 'silvernext') return 'Silver Next';
  if (s === 'xauusd')     return 'XAU/USD';
  if (s === 'xagusd')     return 'XAG/USD';
  if (s === 'inrspot')    return 'INR Spot';
  if (item?.Name)         return String(item.Name).toUpperCase();
  return String(symbol || '').toUpperCase();
}

function indexBySymbol(items) {
  const map = {};
  for (const item of items) {
    const sym = symbolOf(item);
    if (!sym || map[sym]) continue;
    map[sym] = item;
  }
  return map;
}

function standardizeItem(item, sourceKey) {
  if (!item) return null;
  const symbol = symbolOf(item);
  return {
    symbol,
    name:  item.Name || item.Symbol_Name || item.Symbol || labelOf(symbol, item),
    bid:   toNum(item.Bid   ?? item.Buy),
    ask:   toNum(item.Ask   ?? item.Sell),
    high:  toNum(item.High),
    low:   toNum(item.Low),
    open:  toNum(item.Open),
    close: toNum(item.Close),
    diff:  toNum(item.Difference),
    ltp:   toNum(item.LTP),
    time:  item.Time || null,
    source: sourceKey,
  };
}

function visibleProducts(rows, sourceKey) {
  return rows
    .filter(row => String(row?.IsDisplay).toLowerCase() === 'true')
    .map(row    => standardizeItem(row, sourceKey))
    .filter(Boolean);
}

/* Search full raw Rate array by Name field — ignores IsDisplay */
function findRawByName(rows, name) {
  if (!Array.isArray(rows)) return null;
  const t = String(name).trim().toLowerCase();
  return rows.find(r => String(r?.Name ?? '').trim().toLowerCase() === t) || null;
}

/* ══════════════════════════════════════════════════════════════
   FEED HANDLER  (unchanged from Reference)
   ══════════════════════════════════════════════════════════════ */
function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live    = items;
    state[sourceKey].map     = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].rawRate  = data.Rate;
      state[sourceKey].products = visibleProducts(data.Rate, sourceKey);
    } else if (Array.isArray(data)) {
      state[sourceKey].rawRate = data;
    }

    publish();
  } catch (err) {
    console.log(`[${sourceKey}] parse error:`, err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   FEED CONNECTION  (unchanged from Reference)
   ══════════════════════════════════════════════════════════════ */
function connectFeed(sourceKey) {
  const feed   = FEEDS[sourceKey];
  const socket = createClient(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    rejectUnauthorized: false,
  });

  socket.on('connect', () => {
    state[sourceKey].connected = true;
    socket.emit('room',   feed.room);
    socket.emit('Client', feed.room);
    publish();
  });
  socket.on('disconnect',    ()    => { state[sourceKey].connected = false; publish(); });
  socket.on('connect_error', (err) => {
    state[sourceKey].connected = false;
    console.log(`[${sourceKey}] connect_error:`, err.message);
    publish();
  });
  socket.on('ClientData', data => {
    try { state[sourceKey].clientData = typeof data === 'string' ? JSON.parse(data) : data; } catch {}
  });
  socket.on('message',  data => handleFeed(sourceKey, data));
  socket.on('Liverate', data => handleFeed(sourceKey, data));

  return socket;
}

/* ══════════════════════════════════════════════════════════════
   SYMBOL ROUTING  (unchanged from Reference)
   ══════════════════════════════════════════════════════════════ */
function chooseRaw(symbol) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'gold')   return state.gopnath.map.gold   || state.swayam.map.gold   || null;
  if (s === 'silver') return state.swayam.map.silver  || state.gopnath.map.silver || null;
  return state.swayam.map[s] || state.gopnath.map[s] || null;
}

function sourceFor(symbol) {
  const s = String(symbol || '').toLowerCase();
  if (s === 'silver' || s === 'silvernext') return 'swayam';
  return state.gopnath.map[s] ? 'gopnath' : 'swayam';
}

function buildRows(symbols) {
  return symbols
    .map(sym => { const raw = chooseRaw(sym); return raw ? standardizeItem(raw, sourceFor(sym)) : null; })
    .filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════
   CONFIG-DRIVEN BASE RATE LOOKUP
   Source row names come from admin-config.json — no hardcoding.

   Priority:
     1. Visible products (standardized .ask = Sell) — fastest
     2. Full rawRate array (original Name/Ask fields)
     3. Fuzzy keyword fallback
   ══════════════════════════════════════════════════════════════ */
function getBaseAsk(sourceKey, rowName) {
  const target = String(rowName).trim().toLowerCase();

  /* 1 — visible products (already standardized, .ask = Sell) */
  const p = state[sourceKey].products.find(
    p => String(p?.name ?? '').trim().toLowerCase() === target
  );
  if (p?.ask != null) return toNum(p.ask);

  /* 2 — raw Rate array with original field names */
  const r = findRawByName(state[sourceKey].rawRate, rowName)
         || findRawByName(state[sourceKey].live,    rowName);
  if (r) return toNum(r.Ask ?? r.Sell);

  /* 3 — fuzzy: first word > 3 chars in row name */
  const kw = target.split(' ').find(w => w.length > 3);
  if (kw) {
    const fuzzy = [...state[sourceKey].rawRate, ...state[sourceKey].live].find(
      r => String(r?.Name ?? r?.name ?? '').toLowerCase().includes(kw)
    );
    if (fuzzy) return toNum(fuzzy.Ask ?? fuzzy.Sell ?? fuzzy.ask);
  }

  return null;
}

function getGoldBase()      { return getBaseAsk('gopnath', GOLD_BASE_ROW);   }
function getGoldCoinBase()  { return getBaseAsk('gopnath', GOLD_COIN_ROW);   }
function getSilverCoinBase(){ return getBaseAsk('swayam',  SILVER_COIN_ROW); }

/* ══════════════════════════════════════════════════════════════
   PAYLOAD BUILDER
   ══════════════════════════════════════════════════════════════ */
function buildPayload() {
  return {
    updatedAt: state.swayam.lastSeen || state.gopnath.lastSeen || null,
    connected: { gopnath: state.gopnath.connected, swayam: state.swayam.connected },
    summary: {
      gold:   standardizeItem(chooseRaw('gold'),   'gopnath'),
      silver: standardizeItem(chooseRaw('silver'), 'swayam'),
    },
    goldProducts:   state.gopnath.products,
    silverProducts: state.swayam.products,
    futureRows: buildRows(['gold', 'silver', 'goldnext', 'silvernext']),
    spotRows:   buildRows(['xauusd', 'xagusd', 'inrspot']),
    /* Config-driven base rates (Sell price of configured base rows) */
    goldBase:      getGoldBase(),
    goldCoinBase:  getGoldCoinBase(),
    silverCoinBase: getSilverCoinBase(),
  };
}

function publish() {
  io.emit('rates:update', buildPayload());
}

/* ══════════════════════════════════════════════════════════════
   START FEEDS
   ══════════════════════════════════════════════════════════════ */
connectFeed('gopnath');
connectFeed('swayam');

/* ══════════════════════════════════════════════════════════════
   EXPRESS — static files + API
   ══════════════════════════════════════════════════════════════ */
app.use(express.static(path.join(__dirname, 'public')));

/* Config endpoint — loaded once by client on startup */
app.get('/api/config', (req, res) => {
  res.json({ site: siteConfig, admin: adminConfig });
});

/* Snapshot rates endpoint */
app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

/* Debug: shows all raw product names and resolved base rates */
app.get('/api/debug', (req, res) => {
  res.json({
    goldBase:      getGoldBase(),
    goldCoinBase:  getGoldCoinBase(),
    silverCoinBase: getSilverCoinBase(),
    configuredRows: { GOLD_BASE_ROW, GOLD_COIN_ROW, SILVER_COIN_ROW },
    gopnathProducts: state.gopnath.rawRate.map(r => ({ name: r?.Name, ask: r?.Ask ?? r?.Sell, display: r?.IsDisplay })),
    swayamProducts:  state.swayam.rawRate.map(r =>  ({ name: r?.Name, ask: r?.Ask ?? r?.Sell, display: r?.IsDisplay })),
  });
});

/* Dynamic web manifest from config */
app.get('/manifest.webmanifest', (req, res) => {
  const biz   = siteConfig?.business || {};
  const theme = siteConfig?.theme    || {};
  res.json({
    name:             biz.name        || 'Jewellers',
    short_name:       biz.name        || 'Jewellers',
    description:      `${biz.name} – Live gold and silver bullion rates`,
    start_url:        '/',
    display:          'standalone',
    orientation:      'portrait',
    theme_color:      theme.primaryColor || '#003336',
    background_color: theme.primaryColor || '#003336',
    icons: [
      { src: '/Media/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/Media/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

/* ══════════════════════════════════════════════════════════════
   SOCKET — emit snapshot to every new client
   ══════════════════════════════════════════════════════════════ */
io.on('connection', socket => {
  socket.emit('rates:update', buildPayload());
});

httpServer.listen(PORT, () => {
  console.log(`\n  ${siteConfig?.business?.name || 'Jewellers'} Live Rates`);
  console.log(`  Running → http://localhost:${PORT}\n`);
});
