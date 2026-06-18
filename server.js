const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = ROOT;

const CONFIG = {
  gopnath: {
    socketUrl: process.env.GOPNATH_SOCKET_URL || 'https://starlinesupport.in:10001',
    room: process.env.GOPNATH_ROOM || 'gopnathrefinery'
  },
  swayam: {
    socketUrl: process.env.SWAYAM_SOCKET_URL || 'https://starlinesolutions.in:10001',
    room: process.env.SWAYAM_ROOM || 'swayamtrading'
  },
  rightgoldUrl: process.env.RIGHTGOLD_URL || 'https://www.rightgold.com/pages/coin-rate',
  refreshMs: Math.max(15000, Number(process.env.SOURCE_REFRESH_MS || 60000))
};

const state = {
  connected: {
    gopnath: false,
    swayam: false,
    rightgold: false
  },
  updatedAt: null,
  sources: {
    gopnath: {
      items: demoGopnath(),
      map: {},
      lastSeen: nowIso()
    },
    swayam: {
      items: demoSwayam(),
      map: {},
      lastSeen: nowIso()
    },
    rightgold: demoRightGold()
  }
};

function nowIso() {
  return new Date().toISOString();
}

function toNum(val) {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '--') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function roundSmart(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function normalizeRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.Rate)) return data.Rate;
  if (Array.isArray(data.rate)) return data.rate;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function keyOf(item) {
  return String(item?.name || item?.Name || item?.symbol || item?.Symbol || '')
    .trim()
    .toLowerCase();
}

function standardizeItem(item) {
  if (!item) return null;
  return {
    name: String(item.Name || item.Symbol_Name || item.symbol || item.Symbol || item.name || '').trim(),
    buy: toNum(item.Bid ?? item.Buy ?? item.buy ?? item.bid),
    sell: toNum(item.Ask ?? item.Sell ?? item.sell ?? item.ask),
    high: toNum(item.High ?? item.high),
    low: toNum(item.Low ?? item.low),
    open: toNum(item.Open ?? item.open),
    close: toNum(item.Close ?? item.close),
    time: item.Time || item.time || null,
    source: item.source || null
  };
}

function indexRows(rows) {
  const map = {};
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (!map[key]) map[key] = row;
  }
  return map;
}

function labelMatch(row, labels) {
  const text = keyOf(row);
  return labels.some((label) => text.includes(String(label).toLowerCase()));
}

function findRow(rows, labels) {
  return rows.find((row) => labelMatch(row, labels)) || null;
}

function calcKaratRates(baseRow) {
  const base = baseRow?.sell ?? baseRow?.buy;
  if (!Number.isFinite(base)) return [];
  const high = baseRow?.high ?? base;
  const low = baseRow?.low ?? base;
  const karats = [24, 22, 21, 20, 18, 14, 10, 9];
  return karats.map((karat) => {
    const ratio = karat / 24;
    return {
      karat,
      name: `${karat}K`,
      buy: roundSmart(base * ratio),
      sell: roundSmart(base * ratio),
      high: roundSmart(high * ratio),
      low: roundSmart(low * ratio)
    };
  });
}


function demoGopnath() {
  return [
    { name: 'IMP GOLD RTGS', buy: 100000, sell: 100120, high: 100350, low: 99920, source: 'gopnath' },
    { name: 'GOLD REFF', buy: 99940, sell: 100060, high: 100250, low: 99810, source: 'gopnath' },
    { name: 'GOLD REFF L', buy: 99890, sell: 100020, high: 100190, low: 99770, source: 'gopnath' }
  ];
}

function demoSwayam() {
  return [
    { name: 'IMP GOLD RTGS', buy: 100000, sell: 100120, high: 100350, low: 99920, source: 'swayam' },
    { name: 'GOLD REFF', buy: 99940, sell: 100060, high: 100250, low: 99810, source: 'swayam' },
    { name: 'GOLD REFF L', buy: 99890, sell: 100020, high: 100190, low: 99770, source: 'swayam' },
    { name: '925 SILVER ORNA', buy: 1000, sell: 1025, high: 1040, low: 990, source: 'swayam' }
  ];
}

function demoRightGold() {
  return {
    goldCoins: [
      { name: 'GOLD COIN 999 1 GM', buy: 16423, sell: 16423, high: 16423, low: 16423 },
      { name: 'GOLD COIN 999 2 GM', buy: 32845, sell: 32845, high: 32845, low: 32845 },
      { name: 'GOLD COIN 999 5 GM', buy: 82113, sell: 82113, high: 82113, low: 82113 },
      { name: 'GOLD COIN 999 10 GM', buy: 163443, sell: 163443, high: 163443, low: 163443 },
      { name: 'GOLD COIN 999 20 GM', buy: 326886, sell: 326886, high: 326886, low: 326886 },
      { name: 'GOLD COIN 999 50 GM', buy: 813306, sell: 813306, high: 813306, low: 813306 },
      { name: 'GOLD COIN 999 100 GM', buy: 1610972, sell: 1610972, high: 1610972, low: 1610972 }
    ],
    silverCoins: [
      { name: 'SILVER COIN 999 10 GM', buy: 0, sell: 0, high: 0, low: 0 },
      { name: 'SILVER COIN 999 20 GM', buy: 0, sell: 0, high: 0, low: 0 },
      { name: 'SILVER COIN 999 50 GM', buy: 0, sell: 0, high: 0, low: 0 },
      { name: 'SILVER COIN 999 100 GM', buy: 0, sell: 0, high: 0, low: 0 }
    ],
    rawText: '',
    lastSeen: nowIso(),
    demo: true
  };
}

function parseRightGoldHtml(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const makeList = (metal) => {
    const sizes = [1, 2, 5, 10, 20, 50, 100];
    const out = [];
    for (const size of sizes) {
      const patterns = [
        new RegExp(`${metal}\\s+coin\\s*999\\s*${size}\\s*(?:gm|g|gram)\\b.{0,180}?₹\\s*([\\d,]+)`, 'i'),
        new RegExp(`${size}\\s*(?:gm|g|gram)\\b.{0,160}?${metal}\\s+coin\\s*999.{0,80}?₹\\s*([\\d,]+)`, 'i'),
        new RegExp(`${metal}\\s+coin.{0,180}?${size}\\s*(?:gm|g|gram).{0,180}?₹\\s*([\\d,]+)`, 'i')
      ];
      let price = null;
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          price = toNum(match[1]);
          if (Number.isFinite(price)) break;
        }
      }
      if (!Number.isFinite(price)) continue;
      out.push({
        name: `${metal.toUpperCase()} COIN 999 ${size} GM`,
        buy: price,
        sell: price,
        high: price,
        low: price
      });
    }
    return out;
  };

  const goldCoins = makeList('gold');
  const silverCoins = makeList('silver');

  return {
    goldCoins: goldCoins.length ? goldCoins : demoRightGold().goldCoins,
    silverCoins: silverCoins.length ? silverCoins : demoRightGold().silverCoins,
    rawText: text,
    lastSeen: nowIso(),
    demo: false
  };
}

function renderPublicState() {
  const gRows = state.sources.gopnath.items;
  const sRows = state.sources.swayam.items;
  const rData = state.sources.rightgold;

  const gImp = findRow(gRows, ['imp gold rtgs', 'gold imp rtgs', 'imp gold', 'gold rtgs']) || gRows[0] || null;
  const gReff = findRow(gRows, ['gold reff']);
  const gReffL = findRow(gRows, ['gold reff l', 'gold reff l.']);

  const sImp = findRow(sRows, ['imp gold rtgs', 'gold imp rtgs', 'imp gold', 'gold rtgs']) || sRows[0] || null;
  const sReff = findRow(sRows, ['gold reff']);
  const sReffL = findRow(sRows, ['gold reff l', 'gold reff l.']);
  const sOrna = findRow(sRows, ['925 silver orna', '999 silver reff', 'silver reff', 'silver orna']) || sRows.find((r) => keyOf(r).includes('silver')) || null;

  const goldKarat = calcKaratRates(gImp);
  const goldBase = (gImp?.sell ?? gImp?.buy) || null;
  const goldHigh = gImp?.high ?? goldBase;
  const goldLow = gImp?.low ?? goldBase;

  const silverBase = (sImp?.sell ?? sImp?.buy) || null;

  const publicState = {
    connected: {
      gopnath: state.connected.gopnath,
      swayam: state.connected.swayam,
      rightgold: state.connected.rightgold
    },
    updatedAt: state.updatedAt || nowIso(),
    gold: {
      base: {
        name: 'IMP GOLD RTGS',
        buy: gImp?.buy ?? goldBase,
        sell: gImp?.sell ?? goldBase,
        high: goldHigh,
        low: goldLow
      },
      rows: [
        { name: 'IMP GOLD RTGS', buy: gImp?.buy ?? goldBase, sell: gImp?.sell ?? goldBase, high: goldHigh, low: goldLow },
        { name: 'GOLD REFF', buy: gReff?.buy ?? goldBase, sell: gReff?.sell ?? goldBase, high: gReff?.high ?? goldHigh, low: gReff?.low ?? goldLow },
        { name: 'GOLD REFF L', buy: gReffL?.buy ?? goldBase, sell: gReffL?.sell ?? goldBase, high: gReffL?.high ?? goldHigh, low: gReffL?.low ?? goldLow }
      ],
      karats: goldKarat,
      source: 'gopnath'
    },
    silver: {
      rows: [
        { name: 'IMP GOLD RTGS', buy: sImp?.buy ?? silverBase, sell: sImp?.sell ?? silverBase, high: sImp?.high ?? silverBase, low: sImp?.low ?? silverBase },
        { name: 'GOLD REFF', buy: sReff?.buy ?? silverBase, sell: sReff?.sell ?? silverBase, high: sReff?.high ?? silverBase, low: sReff?.low ?? silverBase },
        { name: 'GOLD REFF L', buy: sReffL?.buy ?? silverBase, sell: sReffL?.sell ?? silverBase, high: sReffL?.high ?? silverBase, low: sReffL?.low ?? silverBase },
        { name: '925 SILVER ORNA / 999 SILVER REFF', buy: sOrna?.buy ?? silverBase, sell: sOrna?.sell ?? silverBase, high: sOrna?.high ?? silverBase, low: sOrna?.low ?? silverBase }
      ],
      source: 'swayam'
    },
    coin: {
      gold: rData.goldCoins,
      silver: rData.silverCoins,
      source: 'rightgold'
    }
  };

  return publicState;
}

function emitState() {
  state.updatedAt = nowIso();
  io.emit('state', renderPublicState());
}

function ingestFeed(sourceKey, data) {
  try {
    const rows = normalizeRows(data).map(standardizeItem).filter(Boolean);
    if (!rows.length) return;
    state.sources[sourceKey].items = rows;
    state.sources[sourceKey].map = indexRows(rows);
    state.sources[sourceKey].lastSeen = nowIso();
    state.connected[sourceKey] = true;
    emitState();
  } catch (error) {
    console.error(`[${sourceKey}] feed parse error:`, error.message);
  }
}

function connectSocketFeed(sourceKey) {
  const feed = CONFIG[sourceKey];
  const socket = createClient(feed.socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    rejectUnauthorized: false
  });

  socket.on('connect', () => {
    state.connected[sourceKey] = true;
    try {
      socket.emit('room', feed.room);
      socket.emit('Client', feed.room);
    } catch {}
    emitState();
  });

  socket.on('disconnect', () => {
    state.connected[sourceKey] = false;
    emitState();
  });

  socket.on('connect_error', (err) => {
    state.connected[sourceKey] = false;
    console.error(`[${sourceKey}] connect_error:`, err.message);
    emitState();
  });

  const handler = (payload) => {
    let parsed = payload;
    if (typeof payload === 'string') {
      try { parsed = JSON.parse(payload); } catch {}
    }
    ingestFeed(sourceKey, parsed);
  };

  socket.on('message', handler);
  socket.on('Liverate', handler);
  socket.on('data', handler);

  return socket;
}

async function refreshRightGold() {
  try {
    const res = await fetch(CONFIG.rightgoldUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const parsed = parseRightGoldHtml(html);
    state.sources.rightgold = parsed;
    state.connected.rightgold = true;
    emitState();
  } catch (error) {
    console.error('[rightgold] refresh error:', error.message);
    if (!state.sources.rightgold.goldCoins.length) {
      state.sources.rightgold = demoRightGold();
      emitState();
    }
    state.connected.rightgold = false;
  }
}

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html']
}));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    updatedAt: state.updatedAt,
    connected: state.connected
  });
});

io.on('connection', (socket) => {
  socket.emit('state', renderPublicState());

  socket.on('ping-state', () => {
    socket.emit('state', renderPublicState());
  });
});

emitState();
connectSocketFeed('gopnath');
connectSocketFeed('swayam');
refreshRightGold();
setInterval(refreshRightGold, CONFIG.refreshMs);

httpServer.listen(PORT, () => {
  console.log(`Mahakali Jewellers live rate server running on port ${PORT}`);
});
