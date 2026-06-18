const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const { scrapeCoins } = require('./adapters/rightgold');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

const FEEDS = {
  gopnath: {
    url: process.env.GOPNATH_SOCKET_URL || 'https://starlinesupport.in:10001',
    room: process.env.GOPNATH_SOCKET_ROOM || 'gopnathrefinery'
  },
  swayam: {
    url: process.env.SWAYAM_SOCKET_URL || 'https://starlinesolutions.in:10001',
    room: process.env.SWAYAM_SOCKET_ROOM || 'swayamtrading'
  }
};

const COIN_REFRESH_MS = Number(process.env.COIN_REFRESH_MS || 30000);

const state = {
  connected: {
    gopnath: false,
    swayam: false,
    coins: false
  },
  updatedAt: null,
  errors: {
    coins: null
  },
  gold: {
    all: [],
    products: [],
    future: [],
    spot: [],
    master: null
  },
  silver: {
    all: [],
    products: [],
    future: [],
    spot: [],
    master: null
  },
  coins: {
    gold: [],
    silver: []
  }
};

function toNum(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonical(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.Rate)) return data.Rate;
  if (Array.isArray(data.rate)) return data.rate;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.rows)) return data.rows;
  return [];
}

function normalizeItem(item) {
  const name = normalizeText(
    item?.name ??
    item?.Name ??
    item?.symbol ??
    item?.Symbol ??
    item?.Source ??
    item?.title ??
    item?.Title
  );

  return {
    name,
    key: canonical(name),
    buy: toNum(item?.buy ?? item?.Buy ?? item?.bid ?? item?.Bid ?? item?.rate ?? item?.Rate ?? item?.ltp ?? item?.LTP),
    sell: toNum(item?.sell ?? item?.Sell ?? item?.ask ?? item?.Ask ?? item?.rate ?? item?.Rate ?? item?.ltp ?? item?.LTP),
    high: toNum(item?.high ?? item?.High),
    low: toNum(item?.low ?? item?.Low),
    value: toNum(item?.value ?? item?.Value ?? item?.price ?? item?.Price),
    source: item?.source ?? item?.Source ?? null,
    raw: item
  };
}

function bestMatch(items, labels) {
  const cleaned = items.filter(Boolean);
  for (const label of labels) {
    const key = canonical(label);
    const exact = cleaned.find((it) => it.key === key);
    if (exact) return { ...exact, label };
  }

  for (const label of labels) {
    const terms = canonical(label).split(' ').filter(Boolean);
    const fuzzy = cleaned.find((it) => {
      const hay = it.key;
      return terms.every((term) => hay.includes(term));
    });
    if (fuzzy) return { ...fuzzy, label };
  }

  return null;
}

function pickByRegex(items, regex) {
  return items.filter((it) => regex.test(it.key));
}

function publicState() {
  return {
    connected: state.connected,
    updatedAt: state.updatedAt,
    errors: state.errors,
    gold: {
      master: state.gold.master,
      products: state.gold.products,
      future: state.gold.future,
      spot: state.gold.spot
    },
    silver: {
      master: state.silver.master,
      products: state.silver.products,
      future: state.silver.future,
      spot: state.silver.spot
    },
    coins: state.coins
  };
}

function emitState() {
  state.updatedAt = new Date().toISOString();
  io.emit('state', publicState());
}

function categorizeGold(items) {
  const goldItems = items.filter((it) => !/silver/i.test(it.name));
  const master = bestMatch(goldItems, [
    '999 IMP RTGS',
    'IMP GOLD RTGS',
    '999 IMP',
    'IMP RTGS'
  ]);

  const products = [
    bestMatch(goldItems, ['999 IMP RTGS', 'IMP GOLD RTGS']),
    bestMatch(goldItems, ['GOLD REFF']),
    bestMatch(goldItems, ['GOLD REFF L', 'GOLD REFF ONLY L', 'REFF L'])
  ].filter(Boolean);

  const future = [
    ...pickByRegex(goldItems, /(future|next|xauusd|gold future)/i)
  ];

  const spot = [
    ...pickByRegex(goldItems, /(spot|inr spot|xauusd|gold spot)/i)
  ];

  state.gold.all = goldItems;
  state.gold.master = master;
  state.gold.products = products;
  state.gold.future = future;
  state.gold.spot = spot;
}

function categorizeSilver(items) {
  const silverItems = items.filter((it) => /silver/i.test(it.name));

  const master = bestMatch(silverItems, [
    'IMP SILVER RTGS',
    'SILVER RTGS',
    '999 SILVER RTGS'
  ]);

  const products = [
    bestMatch(silverItems, ['IMP SILVER RTGS', 'SILVER IMP RTGS', '999 SILVER RTGS']),
    bestMatch(silverItems, ['SILVER REFF']),
    bestMatch(silverItems, ['SILVER REFF L', 'SILVER REFF ONLY L', 'REFF L']),
    bestMatch(silverItems, ['925 SILVER ORNA', '999 SILVER REFF', 'SILVER ORNA'])
  ].filter(Boolean);

  const future = [
    ...pickByRegex(silverItems, /(future|next|xagusd|silver future)/i)
  ];

  const spot = [
    ...pickByRegex(silverItems, /(spot|inr spot|xagusd|silver spot)/i)
  ];

  state.silver.all = silverItems;
  state.silver.master = master;
  state.silver.products = products;
  state.silver.future = future;
  state.silver.spot = spot;
}

function processFeed(sourceKey, payload) {
  const items = normalizeArray(
    typeof payload === 'string' ? safeJsonParse(payload) : payload
  ).map(normalizeItem).filter((it) => it.name);

  if (!items.length) return;

  if (sourceKey === 'gopnath') {
    categorizeGold(items);
  }

  if (sourceKey === 'swayam') {
    categorizeSilver(items);
  }

  emitState();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function connectFeed(sourceKey) {
  const feed = FEEDS[sourceKey];
  const socket = createClient(feed.url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    rejectUnauthorized: false
  });

  socket.on('connect', () => {
    state.connected[sourceKey] = true;
    socket.emit('room', feed.room);
    socket.emit('Client', feed.room);
    emitState();
  });

  socket.on('disconnect', () => {
    state.connected[sourceKey] = false;
    emitState();
  });

  socket.on('connect_error', (err) => {
    state.connected[sourceKey] = false;
    state.errors[sourceKey] = err?.message || 'connect_error';
    emitState();
    console.log(`[${sourceKey}] connect_error:`, err?.message || err);
  });

  socket.on('ClientData', (data) => {
    const parsed = typeof data === 'string' ? safeJsonParse(data) : data;
    if (parsed && typeof parsed === 'object') {
      state.errors[sourceKey] = null;
    }
  });

  socket.on('message', (data) => processFeed(sourceKey, data));
  socket.on('Liverate', (data) => processFeed(sourceKey, data));
  socket.on('data', (data) => processFeed(sourceKey, data));

  return socket;
}

async function refreshCoins() {
  try {
    const coinData = await scrapeCoins();

    state.coins.gold = Array.isArray(coinData.goldCoins) ? coinData.goldCoins : [];
    state.coins.silver = Array.isArray(coinData.silverCoins) ? coinData.silverCoins : [];
    state.connected.coins = true;
    state.errors.coins = null;

    emitState();
  } catch (err) {
    state.connected.coins = false;
    state.errors.coins = err?.message || 'coin scrape failed';
    emitState();
    console.log('[coins] scrape error:', err?.message || err);
  }
}

function startCollectors() {
  connectFeed('gopnath');
  connectFeed('swayam');
  refreshCoins();
  setInterval(refreshCoins, COIN_REFRESH_MS);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/Media', express.static(path.join(__dirname, 'Media')));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    updatedAt: state.updatedAt,
    connected: state.connected
  });
});

app.get('/api/state', (req, res) => {
  res.json(publicState());
});

app.get('/api/coins', (req, res) => {
  res.json({
    updatedAt: state.updatedAt,
    connected: state.connected.coins,
    gold: state.coins.gold,
    silver: state.coins.silver,
    error: state.errors.coins
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('request-state', () => {
    socket.emit('state', publicState());
  });
});

startCollectors();

server.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on port ${PORT}`);
});