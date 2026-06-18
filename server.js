
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const cheerio = require('cheerio');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

const CONFIG = {
  gopnath: {
    url: process.env.GOPNATH_SOCKET_URL || 'https://starlinesupport.in:10001',
    room: process.env.GOPNATH_ROOM || 'gopnathrefinery',
  },
  swayam: {
    url: process.env.SWAYAM_SOCKET_URL || 'https://starlinesolutions.in:10001',
    room: process.env.SWAYAM_ROOM || 'swayamtrading',
  },
  rightgoldUrl: process.env.RIGHTGOLD_URL || 'https://www.rightgold.com/pages/live-rate',
  rightgoldPollMs: Math.max(10000, Number(process.env.RIGHTGOLD_POLL_MS || 30000)),
  marketSource: (process.env.MARKET_SOURCE || 'gopnath').toLowerCase(), // gopnath | swayam
  demoFallback: String(process.env.ENABLE_DEMO_FALLBACK || 'true').toLowerCase() === 'true',
};

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
  rightgold: {
    connected: false,
    lastSeen: null,
    rows: [],
    rawText: '',
  },
};

function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').replace(/[₹$]/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function roundRate(val) {
  const n = toNum(val);
  return n === null ? null : Math.round(n);
}

function normalizeFeed(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.Rate)) return data.Rate;
  if (Array.isArray(data.rate)) return data.rate;
  if (Array.isArray(data.data)) return data.data;
  if (data.Rate && typeof data.Rate === 'object') return Object.values(data.Rate);
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? item?.code ?? item?.Name ?? '')
    .trim()
    .toLowerCase();
}

function labelOf(symbol, item) {
  const sym = String(symbol || '').toLowerCase();
  if (sym === 'gold') return 'Gold';
  if (sym === 'silver') return 'Silver';
  if (sym === 'goldnext') return 'Gold Next';
  if (sym === 'silvernext') return 'Silver Next';
  if (sym === 'xauusd') return 'Gold Spot';
  if (sym === 'xagusd') return 'Silver Spot';
  if (sym === 'inrspot') return 'INR Spot';
  if (item?.Name) return String(item.Name).toUpperCase();
  return String(symbol || '').toUpperCase();
}

function indexBySymbol(items) {
  const map = {};
  for (const item of items || []) {
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
    bid: toNum(item.Bid ?? item.Buy ?? item.bid ?? item.buy),
    ask: toNum(item.Ask ?? item.Sell ?? item.ask ?? item.sell),
    high: toNum(item.High ?? item.high),
    low: toNum(item.Low ?? item.low),
    open: toNum(item.Open ?? item.open),
    close: toNum(item.Close ?? item.close),
    diff: toNum(item.Difference ?? item.diff),
    ltp: toNum(item.LTP ?? item.ltp),
    time: item.Time || item.time || null,
    source: sourceKey,
  };
}

function visibleProducts(rows, sourceKey) {
  return rows
    .filter((row) => {
      const disp = row?.IsDisplay ?? row?.display;
      if (disp === undefined || disp === null) return true;
      return String(disp).toLowerCase() === 'true' || String(disp) === '1';
    })
    .map((row) => standardizeItem(row, sourceKey))
    .filter(Boolean);
}

function isRelevantLabel(text, label) {
  return String(text || '').toLowerCase().includes(String(label || '').toLowerCase());
}

function findFirstMatch(items, patterns) {
  const normalized = (items || []).map((row) => standardizeItem(row, row?.source || 'unknown')).filter(Boolean);
  for (const pattern of patterns) {
    const p = String(pattern).toLowerCase();
    const exact = normalized.find((row) => {
      const hay = `${row.name} ${row.symbol}`.toLowerCase();
      return hay.includes(p);
    });
    if (exact) return exact;
  }
  return null;
}

function chooseMarketRow(symbol, preferred = CONFIG.marketSource) {
  const s = String(symbol || '').toLowerCase();
  const order = preferred === 'swayam' ? ['swayam', 'gopnath'] : ['gopnath', 'swayam'];
  for (const src of order) {
    const item = state[src].map[s];
    if (item) return item;
  }
  return null;
}

function buildKaratRows(baseRow) {
  const baseBid = toNum(baseRow?.bid ?? baseRow?.ask ?? baseRow?.ltp);
  const baseAsk = toNum(baseRow?.ask ?? baseRow?.bid ?? baseRow?.ltp);
  const baseHigh = toNum(baseRow?.high ?? baseAsk ?? baseBid);
  const baseLow = toNum(baseRow?.low ?? baseBid ?? baseAsk);
  if (baseBid === null && baseAsk === null) return [];

  const ratios = [
    ['24K', 1.0000],
    ['22K', 22 / 24],
    ['21K', 21 / 24],
    ['20K', 20 / 24],
    ['18K', 18 / 24],
    ['14K', 14 / 24],
    ['10K', 10 / 24],
    ['9K', 9 / 24],
  ];

  return ratios.map(([label, ratio]) => ({
    symbol: label.toLowerCase(),
    name: label,
    bid: baseBid === null ? null : roundRate(baseBid * ratio),
    ask: baseAsk === null ? null : roundRate(baseAsk * ratio),
    high: baseHigh === null ? null : roundRate(baseHigh * ratio),
    low: baseLow === null ? null : roundRate(baseLow * ratio),
    source: 'gopnath',
  }));
}

function normalizeRightgoldRowsFromText(text) {
  const rows = [];
  const clean = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\t]+/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const targets = [
    { name: 'Gold Coin 1g', aliases: ['gold coin 1g', '1g gold coin', '1 gm gold coin', 'gold 1g coin'] },
    { name: 'Gold Coin 2g', aliases: ['gold coin 2g', '2g gold coin', '2 gm gold coin'] },
    { name: 'Gold Coin 5g', aliases: ['gold coin 5g', '5g gold coin', '5 gm gold coin'] },
    { name: 'Gold Coin 10g', aliases: ['gold coin 10g', '10g gold coin', '10 gm gold coin'] },
    { name: 'Gold Coin 20g', aliases: ['gold coin 20g', '20g gold coin', '20 gm gold coin'] },
    { name: 'Silver Coin 1g', aliases: ['silver coin 1g', '1g silver coin', '1 gm silver coin'] },
    { name: 'Silver Coin 10g', aliases: ['silver coin 10g', '10g silver coin', '10 gm silver coin'] },
  ];

  const searchSpace = clean.join(' | ');

  for (const target of targets) {
    let line = clean.find((row) => target.aliases.some((a) => row.toLowerCase().includes(a)));
    if (!line) {
      const idx = searchSpace.toLowerCase().indexOf(target.aliases[0]);
      if (idx >= 0) {
        line = searchSpace.slice(Math.max(0, idx - 120), idx + 240);
      }
    }
    if (!line) continue;

    const nums = (line.match(/(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi) || [])
      .map((x) => toNum(x))
      .filter((n) => n !== null);

    if (!nums.length) continue;
    rows.push({
      symbol: target.name.toLowerCase().replace(/\s+/g, '_'),
      name: target.name,
      bid: roundRate(nums[0]),
      ask: roundRate(nums[1] ?? nums[0]),
      high: roundRate(nums[2] ?? nums[0]),
      low: roundRate(nums[3] ?? nums[0]),
      source: 'rightgold',
    });
  }

  return rows;
}

function normalizeRightgoldHtml(html) {
  const $ = cheerio.load(html);
  const blocks = [];

  $('table tr, li, p, div, span').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length >= 8 && text.length <= 500) blocks.push(text);
  });

  if (!blocks.length) {
    blocks.push($('body').text().replace(/\s+/g, ' ').trim());
  }

  return normalizeRightgoldRowsFromText(blocks.join('\n'));
}

function buildDemoRows() {
  return {
    gopnath: [
      { symbol: 'gold', name: 'IMP GOLD RTGS', bid: 7540, ask: 7560, high: 7580, low: 7480 },
      { symbol: 'goldnext', name: 'GOLD FUTURE', bid: 7560, ask: 7580, high: 7600, low: 7500 },
      { symbol: 'xauusd', name: 'GOLD SPOT', bid: 7530, ask: 7550, high: 7570, low: 7470 },
    ],
    swayam: [
      { symbol: 'silver', name: 'SILVER 999', bid: 98000, ask: 98200, high: 98500, low: 97000 },
      { symbol: 'silvernext', name: 'SILVER FUTURE', bid: 98100, ask: 98300, high: 98600, low: 97100 },
      { symbol: 'xagusd', name: 'SILVER SPOT', bid: 97900, ask: 98100, high: 98400, low: 96800 },
      { symbol: 'inrspot', name: 'INR SPOT', bid: 83.1, ask: 83.3, high: 83.4, low: 82.9 },
    ],
    rightgold: [
      { symbol: 'gold_coin_1g', name: 'Gold Coin 1g', bid: 9000, ask: 9050, high: 9100, low: 8950, source: 'rightgold' },
      { symbol: 'gold_coin_10g', name: 'Gold Coin 10g', bid: 88000, ask: 88300, high: 88600, low: 87500, source: 'rightgold' },
      { symbol: 'silver_coin_10g', name: 'Silver Coin 10g', bid: 1100, ask: 1120, high: 1130, low: 1080, source: 'rightgold' },
    ],
  };
}

function ensureDemoFallback() {
  if (!CONFIG.demoFallback) return;
  const demo = buildDemoRows();
  if (!state.gopnath.live.length) {
    state.gopnath.live = demo.gopnath;
    state.gopnath.map = indexBySymbol(demo.gopnath);
    state.gopnath.products = visibleProducts(demo.gopnath, 'gopnath');
    state.gopnath.lastSeen = state.gopnath.lastSeen || new Date().toISOString();
  }
  if (!state.swayam.live.length) {
    state.swayam.live = demo.swayam;
    state.swayam.map = indexBySymbol(demo.swayam);
    state.swayam.products = visibleProducts(demo.swayam, 'swayam');
    state.swayam.lastSeen = state.swayam.lastSeen || new Date().toISOString();
  }
  if (!state.rightgold.rows.length) {
    state.rightgold.rows = demo.rightgold;
    state.rightgold.lastSeen = state.rightgold.lastSeen || new Date().toISOString();
    state.rightgold.connected = true;
  }
}

function handleFeed(sourceKey, data) {
  try {
    const items = normalizeFeed(data);
    if (!items.length) return;

    state[sourceKey].live = items;
    state[sourceKey].map = indexBySymbol(items);
    state[sourceKey].lastSeen = new Date().toISOString();

    if (data && Array.isArray(data.Rate)) {
      state[sourceKey].products = visibleProducts(data.Rate, sourceKey);
    } else if (Array.isArray(items)) {
      state[sourceKey].products = visibleProducts(items, sourceKey);
    }

    publish();
  } catch (err) {
    console.log(`[${sourceKey}] parse error:`, err.message);
  }
}

function connectFeed(sourceKey) {
  const feed = CONFIG[sourceKey];
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
      state[sourceKey].clientData = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      // ignore
    }
  });

  socket.on('message', (data) => handleFeed(sourceKey, data));
  socket.on('Liverate', (data) => handleFeed(sourceKey, data));

  return socket;
}

async function refreshRightGold() {
  try {
    const res = await fetch(CONFIG.rightgoldUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MahakaliJewellers/1.0)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const rows = normalizeRightgoldHtml(html);

    state.rightgold.connected = true;
    state.rightgold.lastSeen = new Date().toISOString();
    state.rightgold.rawText = html;
    state.rightgold.rows = rows.length ? rows : state.rightgold.rows;
    publish();
  } catch (err) {
    state.rightgold.connected = false;
    console.log('[rightgold] refresh error:', err.message);
    publish();
  }
}

function chooseRaw(symbol) {
  const sym = String(symbol || '').toLowerCase();
  const preferred = CONFIG.marketSource === 'swayam' ? ['swayam', 'gopnath'] : ['gopnath', 'swayam'];

  if (sym === 'gold') {
    for (const src of preferred) {
      const found = findFirstMatch(Object.values(state[src].map), ['imp gold rtgs', 'gold rtgs', 'gold']);
      if (found) return found;
    }
  }

  if (sym === 'silver') {
    for (const src of preferred.slice().reverse()) {
      const found = findFirstMatch(Object.values(state[src].map), ['silver 999', 'silver', '999.s']);
      if (found) return found;
    }
  }

  return state[preferred[0]].map[sym] || state[preferred[1]].map[sym] || null;
}

function chooseGoldBase() {
  return (
    findFirstMatch(Object.values(state.gopnath.map), [
      'imp gold rtgs',
      'gold rtgs',
      '999 imp rtgs',
      'gold',
    ]) ||
    chooseRaw('gold') ||
    null
  );
}

function buildGoldRows() {
  const base = chooseGoldBase();
  return buildKaratRows(base);
}

function isSilverish(row) {
  const text = `${row?.name || ''} ${row?.symbol || ''}`.toLowerCase();
  return /silver|999\.?s|98\.?s|peti|rtgs/.test(text);
}

function buildSilverRows() {
  const preferred = CONFIG.marketSource === 'swayam' ? state.swayam : state.gopnath;
  const fallback = preferred === state.swayam ? state.gopnath : state.swayam;

  const sourceRows = [
    ...(preferred.products?.length ? preferred.products : Object.values(preferred.map).map((r) => standardizeItem(r, preferred === state.swayam ? 'swayam' : 'gopnath'))),
    ...(fallback.products?.length ? fallback.products : Object.values(fallback.map).map((r) => standardizeItem(r, fallback === state.swayam ? 'swayam' : 'gopnath'))),
  ].filter(Boolean);

  return sourceRows
    .filter(isSilverish)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      bid: r.bid,
      ask: r.ask,
      high: r.high,
      low: r.low,
      source: r.source,
    }));
}

function buildFutureRows() {
  const source = CONFIG.marketSource === 'swayam' ? state.swayam : state.gopnath;
  const alt = source === state.swayam ? state.gopnath : state.swayam;
  const goldFuture = chooseRaw('goldnext') || chooseRaw('gold');
  const silverFuture = chooseRaw('silvernext') || chooseRaw('silver');

  const rows = [
    goldFuture && standardizeItem(goldFuture, goldFuture.source || 'gopnath'),
    silverFuture && standardizeItem(silverFuture, silverFuture.source || 'swayam'),
  ].filter(Boolean);

  if (!rows.length) {
    const fallback = [
      source.map.goldnext || alt.map.goldnext,
      source.map.silvernext || alt.map.silvernext,
    ].filter(Boolean).map((r) => standardizeItem(r, source === state.swayam ? 'swayam' : 'gopnath'));
    return fallback.filter(Boolean);
  }

  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name || labelOf(r.symbol),
    bid: r.bid,
    ask: r.ask,
    high: r.high,
    low: r.low,
    source: r.source,
  }));
}

function buildSpotRows() {
  const source = CONFIG.marketSource === 'swayam' ? state.swayam : state.gopnath;
  const alt = source === state.swayam ? state.gopnath : state.swayam;
  const rows = [
    chooseRaw('xauusd'),
    chooseRaw('xagusd'),
    chooseRaw('inrspot'),
  ].filter(Boolean).map((r) => standardizeItem(r, r.source || (source === state.swayam ? 'swayam' : 'gopnath')));

  if (rows.length) {
    return rows;
  }

  const fallback = [source.map.xauusd || alt.map.xauusd, source.map.xagusd || alt.map.xagusd, source.map.inrspot || alt.map.inrspot]
    .filter(Boolean)
    .map((r) => standardizeItem(r, source === state.swayam ? 'swayam' : 'gopnath'));

  return fallback;
}

function buildCoinRows() {
  return (state.rightgold.rows || []).map((r) => ({
    symbol: r.symbol,
    name: r.name,
    bid: r.bid,
    ask: r.ask,
    high: r.high,
    low: r.low,
    source: 'rightgold',
  }));
}

function buildPayload() {
  ensureDemoFallback();
  const gopnathGold = chooseGoldBase();
  const goldBase = gopnathGold ? standardizeItem(gopnathGold, 'gopnath') : null;

  return {
    updatedAt: state.rightgold.lastSeen || state.swayam.lastSeen || state.gopnath.lastSeen || null,
    connected: {
      gopnath: state.gopnath.connected,
      swayam: state.swayam.connected,
      rightgold: state.rightgold.connected,
    },
    goldBase,
    goldRows: buildGoldRows(),
    silverRows: buildSilverRows(),
    futureRows: buildFutureRows(),
    spotRows: buildSpotRows(),
    coinRows: buildCoinRows(),
  };
}

function publish() {
  io.emit('rates:update', buildPayload());
}

connectFeed('gopnath');
connectFeed('swayam');
refreshRightGold();
setInterval(refreshRightGold, CONFIG.rightgoldPollMs);

app.use(express.static(__dirname));

app.get('/api/rates', (req, res) => {
  res.json(buildPayload());
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    updatedAt: buildPayload().updatedAt,
    connected: {
      gopnath: state.gopnath.connected,
      swayam: state.swayam.connected,
      rightgold: state.rightgold.connected,
    },
  });
});

io.on('connection', (socket) => {
  socket.emit('rates:update', buildPayload());
});

httpServer.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on http://localhost:${PORT}`);
});
