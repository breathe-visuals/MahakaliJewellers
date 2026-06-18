const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createGopnathCollector } = require('./adapters/gopnath');
const { createSwayamCollector } = require('./adapters/swayam');
const { createRightGoldCollector } = require('./adapters/rightgold');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

const state = {
  connected: {
    gopnath: false,
    swayam: false,
    coins: false
  },
  updatedAt: null,
  errors: {
    gopnath: null,
    swayam: null,
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

let broadcastTimer = null;

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNum(value) {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function canonical(value) {
  return cleanText(value).toLowerCase();
}

function normalizeArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  if (typeof payload === 'object') {
    const keys = [
      'data',
      'items',
      'rows',
      'products',
      'mainProducts',
      'referanceProducts',
      'Rate',
      'rate'
    ];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }

  return [];
}

function normalizeItem(item) {
  const name = cleanText(
    item?.name ??
    item?.Name ??
    item?.symbol ??
    item?.Symbol ??
    item?.title ??
    item?.Title ??
    item?.Source
  );

  return {
    name,
    key: canonical(name),
    src: cleanText(item?.src ?? item?.source ?? item?.Src ?? item?.Symbol).toLowerCase(),
    id: item?.id ?? item?.ID ?? null,
    bid: toNum(item?.bid ?? item?.Bid),
    ask: toNum(item?.ask ?? item?.Ask),
    high: toNum(item?.High ?? item?.high),
    low: toNum(item?.Low ?? item?.low),
    value: toNum(item?.value ?? item?.Value ?? item?.price ?? item?.Price ?? item?.rate ?? item?.Rate),
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

function mapProduct(it) {
  if (!it) return it;
  return {
    ...it,
    buy: it.bid,
    sell: it.ask ?? it.bid,
  };
}

function publicState() {
  return {
    connected: state.connected,
    updatedAt: state.updatedAt,
    errors: state.errors,
    gold: {
      master: mapProduct(state.gold.master),
      products: (state.gold.products || []).map(mapProduct),
      future: (state.gold.future || []).map(mapProduct),
      spot: (state.gold.spot || []).map(mapProduct)
    },
    silver: {
      master: mapProduct(state.silver.master),
      products: (state.silver.products || []).map(mapProduct),
      future: (state.silver.future || []).map(mapProduct),
      spot: (state.silver.spot || []).map(mapProduct)
    },
    coins: state.coins
  };
}

function broadcast() {
  state.updatedAt = new Date().toISOString();

  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    io.emit('state', publicState());
  }, 300);
}

function updateGold(payload) {
  const items = normalizeArray(payload).map(normalizeItem).filter(it => it.name);
  if (!items.length) return;

  state.gold.all = items;

  // Karat base = 999 IMP RTGS
  state.gold.master =
    bestMatch(items, ['999 IMP RTGS', 'IMP GOLD RTGS', '999 IMP']) ||
    items[0] || null;

  // Exact 3 products
  state.gold.products = [
    bestMatch(items, ['999 IMP RTGS', 'IMP GOLD RTGS', '999 IMP']),
    bestMatch(items, ['REFF ONLY L',  'GOLD REFF L',   'REFF L']),
    bestMatch(items, ['REFF ONLY IMP','GOLD REFF ONLY IMP', 'REFF ONLY', 'GOLD REFF'])
  ].filter(Boolean);

  if (!state.gold.products.length) state.gold.products = items.slice(0, 3);

  state.gold.future = pickByRegex(items, /(future|next|goldnext|gold next)/i);
  state.gold.spot   = pickByRegex(items, /(spot|inrspot|inr spot)/i);

  broadcast();
}

function updateSilver(payload) {
  const items = normalizeArray(payload).map(normalizeItem).filter(it => it.name);
  if (!items.length) return;

  state.silver.all = items;
  state.silver.master =
    bestMatch(items, ['98.S RTGS', 'IMP SILVER RTGS', 'SILVER RTGS']) ||
    items[0] || null;

  // Exact 4 products
  state.silver.products = [
    bestMatch(items, ['98.S REF+GST',   '98.S REF GST',   '98S REF GST']),
    bestMatch(items, ['98.S RTGS',      'IMP SILVER RTGS','SILVER RTGS']),
    bestMatch(items, ['SILVER 999+GST', '999 SILVER+GST', 'SILVER 999']),
    bestMatch(items, ['SILVER PETI RTGS','PETI RTGS',     'SILVER PETI'])
  ].filter(Boolean);

  if (!state.silver.products.length) state.silver.products = items.slice(0, 4);

  state.silver.future = pickByRegex(items, /(future|next|silvernext|silver next)/i);
  state.silver.spot   = pickByRegex(items, /(spot|inrspot|inr spot)/i);

  broadcast();
}

function updateCoins(result) {
  if (!result) return;

  const goldCoins = Array.isArray(result.goldCoins) ? result.goldCoins : [];
  const silverCoins = Array.isArray(result.silverCoins) ? result.silverCoins : [];

  if (!goldCoins.length && !silverCoins.length) return;

  state.coins.gold = goldCoins;
  state.coins.silver = silverCoins;
  state.connected.coins = true;
  state.errors.coins = null;

  broadcast();
}

createGopnathCollector({
  onConnect: () => {
    state.connected.gopnath = true;
    state.errors.gopnath = null;
    broadcast();
  },
  onDisconnect: () => {
    state.connected.gopnath = false;
    broadcast();
  },
  onError: (err) => {
    state.connected.gopnath = false;
    state.errors.gopnath = err?.message || 'gopnath connect_error';
    broadcast();
  },
  onData: updateGold
});

createSwayamCollector({
  onConnect: () => {
    state.connected.swayam = true;
    state.errors.swayam = null;
    broadcast();
  },
  onDisconnect: () => {
    state.connected.swayam = false;
    broadcast();
  },
  onError: (err) => {
    state.connected.swayam = false;
    state.errors.swayam = err?.message || 'swayam connect_error';
    broadcast();
  },
  onData: updateSilver
});

createRightGoldCollector({
  onConnect: () => {
    state.connected.coins = true;
    state.errors.coins = null;
    broadcast();
  },
  onDisconnect: () => {
    state.connected.coins = false;
    broadcast();
  },
  onError: (err) => {
    state.connected.coins = false;
    state.errors.coins = err?.message || 'rightgold connect_error';
    broadcast();
  },
  onCoins: updateCoins
});

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
    connected: state.connected.coins,
    updatedAt: state.updatedAt,
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

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

server.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on port ${PORT}`);
});