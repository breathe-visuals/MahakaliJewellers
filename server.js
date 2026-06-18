const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createGopnathCollector } = require('./adapters/gopnath');
const { createSwayamCollector } = require('./adapters/swayam');
const { createRightGoldCollector } = require('./adapters/rightgold');

const PORT = Number(process.env.PORT || 3000);
const RIGHTGOLD_URL = process.env.RIGHTGOLD_URL || 'https://chawlajewellers.com/coinrate-iframe';
const RIGHTGOLD_REFRESH_MS = Number(process.env.RIGHTGOLD_REFRESH_MS || 60000);
const RIGHTGOLD_RETRY_MS = Number(process.env.RIGHTGOLD_RETRY_MS || 15000);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/Media', express.static(path.join(__dirname, 'Media')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

function toNum(val) {
  if (val === undefined || val === null || val === '') return null;
  const cleaned = String(val).replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(val) {
  const n = toNum(val);
  return n === null ? null : n;
}

function normalizeFeed(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.Rate)) return data.Rate;
  if (Array.isArray(data.rate)) return data.rate;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function symbolOf(item) {
  return String(item?.symbol ?? item?.Symbol ?? item?.Source ?? item?.name ?? item?.Name ?? '')
    .trim()
    .toLowerCase();
}

function nameOf(item) {
  return String(item?.name ?? item?.Name ?? item?.Symbol_Name ?? item?.Symbol ?? item?.Source ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseValue(item) {
  const values = [item?.Sell, item?.sell, item?.Ask, item?.ask, item?.Buy, item?.buy, item?.Bid, item?.bid, item?.LTP, item?.ltp, item?.Close, item?.close, item?.Open, item?.open, item?.Price, item?.price];
  for (const v of values) {
    const n = fmtNum(v);
    if (n !== null) return n;
  }
  return null;
}

function standardizeItem(item, sourceKey) {
  const symbol = symbolOf(item);
  return {
    symbol,
    name: nameOf(item) || symbol.toUpperCase(),
    buy: fmtNum(item?.Buy ?? item?.buy ?? item?.Bid ?? item?.bid),
    sell: fmtNum(item?.Sell ?? item?.sell ?? item?.Ask ?? item?.ask),
    high: fmtNum(item?.High ?? item?.high),
    low: fmtNum(item?.Low ?? item?.low),
    open: fmtNum(item?.Open ?? item?.open),
    close: fmtNum(item?.Close ?? item?.close),
    ltp: fmtNum(item?.LTP ?? item?.ltp),
    price: chooseValue(item),
    source: sourceKey,
  };
}

function pickFirst(items, patterns) {
  const hay = items || [];
  for (const pattern of patterns) {
    const found = hay.find((it) => pattern.test(it.name) || pattern.test(it.symbol));
    if (found) return found;
  }
  return null;
}

function pickOrdered(items, keys) {
  const hay = items || [];
  const used = new Set();
  const out = [];

  for (const key of keys) {
    const found = hay.find((it, idx) => !used.has(idx) && it.name.toLowerCase().includes(key));
    if (found) {
      used.add(hay.indexOf(found));
      out.push(found);
    }
  }

  if (!out.length) {
    return hay.slice(0, keys.length);
  }

  return out;
}

function mapRates(rows) {
  return (rows || []).map((row) => ({
    name: row.name,
    buy: row.buy,
    sell: row.sell,
    high: row.high,
    low: row.low,
    price: row.price,
    symbol: row.symbol,
  }));
}

const state = {
  gopnath: { connected: false, lastSeen: null, items: [], map: {}, error: null },
  swayam: { connected: false, lastSeen: null, items: [], map: {}, error: null },
  rightgold: { connected: false, lastSeen: null, gold: [], silver: [], error: null },
};

function buildKaratSeries(baseRate) {
  const factors = [24, 22, 21, 20, 18, 14, 10, 9];
  return factors.map((karat) => {
    const rate = baseRate ? Math.round(baseRate * (karat / 24)) : null;
    return {
      label: `${karat}K`,
      rate,
      high: rate ? Math.round(rate * 1.006) : null,
      low: rate ? Math.round(rate * 0.994) : null,
      note: karat === 24 ? 'LIVERATE' : 'LIVE',
    };
  });
}

function buildSeriesItem(label, item) {
  if (!item) return [];
  const price = chooseValue(item);
  return [{
    name: label,
    buy: item.buy,
    sell: item.sell ?? price,
    high: item.high,
    low: item.low,
    price,
    source: item.source,
  }];
}

function buildSnapshot() {
  const gItems = state.gopnath.items || [];
  const sItems = state.swayam.items || [];

  const goldProducts = mapRates(pickOrdered(gItems, ['999 imp rtgs', 'reff only l', 'reff only imp']));
  const silverProducts = mapRates(pickOrdered(sItems, ['98.s ref+gst', '98.s rtgs', 'silver 999+gst', 'silver peti rtgs']));

  const goldBase = goldProducts.find((row) => /999 imp rtgs/i.test(row.name)) || goldProducts[0] || null;
  const baseRate = goldBase ? (goldBase.sell ?? goldBase.buy ?? goldBase.price) : null;

  const goldFuture = pickFirst(gItems.concat(sItems), [/goldnext/i, /gold future/i, /future/i, /xau\/usd/i]);
  const goldSpot = pickFirst(gItems.concat(sItems), [/inrspot/i, /gold spot/i, /spot/i, /xau\/usd/i]);
  const silverFuture = pickFirst(sItems.concat(gItems), [/silvernext/i, /silver future/i, /future/i, /xag\/usd/i]);
  const silverSpot = pickFirst(sItems.concat(gItems), [/inrspot/i, /silver spot/i, /spot/i, /xag\/usd/i]);

  return {
    meta: {
      updatedAt: new Date().toISOString(),
      gopnathUpdatedAt: state.gopnath.lastSeen,
      swayamUpdatedAt: state.swayam.lastSeen,
      rightgoldUpdatedAt: state.rightgold.lastSeen,
      gopnathConnected: state.gopnath.connected,
      swayamConnected: state.swayam.connected,
      rightgoldConnected: state.rightgold.connected,
      errors: {
        gopnath: state.gopnath.error,
        swayam: state.swayam.error,
        rightgold: state.rightgold.error,
      },
    },
    gold: {
      karats: buildKaratSeries(baseRate),
      rates: goldProducts,
      future: buildSeriesItem('GOLD FUTURE', goldFuture),
      spot: buildSeriesItem('GOLD SPOT', goldSpot),
    },
    silver: {
      rates: silverProducts,
      future: buildSeriesItem('SILVER FUTURE', silverFuture),
      spot: buildSeriesItem('SILVER SPOT', silverSpot),
    },
    coins: {
      gold: state.rightgold.gold || [],
      silver: state.rightgold.silver || [],
    },
  };
}

function publish() {
  io.emit('snapshot', buildSnapshot());
}

function handleFeed(sourceKey, data) {
  const items = normalizeFeed(data).map((row) => standardizeItem(row, sourceKey));
  if (!items.length) return;
  state[sourceKey].items = items;
  state[sourceKey].map = Object.fromEntries(items.filter((it) => it.symbol).map((it) => [it.symbol, it]));
  state[sourceKey].lastSeen = new Date().toISOString();
  state[sourceKey].connected = true;
  state[sourceKey].error = null;
  publish();
}

function createSource(sourceKey, factory) {
  return factory({
    onConnect() {
      state[sourceKey].connected = true;
      state[sourceKey].error = null;
      publish();
    },
    onDisconnect() {
      state[sourceKey].connected = false;
      publish();
    },
    onData(data) {
      handleFeed(sourceKey, data);
    },
    onError(err) {
      state[sourceKey].connected = false;
      state[sourceKey].error = err?.message || String(err);
      publish();
    },
  });
}

let gopnathSource = null;
let swayamSource = null;
let rightgoldCollector = null;
let rightgoldTimer = null;
let rightgoldBusy = false;

async function collectRightGold() {
  if (rightgoldBusy) return;
  rightgoldBusy = true;

  try {
    if (!rightgoldCollector) {
      rightgoldCollector = createRightGoldCollector({ url: RIGHTGOLD_URL });
    }

    const payload = await rightgoldCollector.scrape();
    state.rightgold.connected = true;
    state.rightgold.error = null;
    state.rightgold.lastSeen = new Date().toISOString();
    state.rightgold.gold = mapRates(payload.gold || []);
    state.rightgold.silver = mapRates(payload.silver || []);
    publish();
  } catch (err) {
    state.rightgold.connected = false;
    state.rightgold.error = err?.message || String(err);
    publish();
  } finally {
    rightgoldBusy = false;
    clearTimeout(rightgoldTimer);
    rightgoldTimer = setTimeout(collectRightGold, state.rightgold.lastSeen ? RIGHTGOLD_REFRESH_MS : RIGHTGOLD_RETRY_MS);
  }
}

function startCollectors() {
  gopnathSource = createSource('gopnath', createGopnathCollector);
  swayamSource = createSource('swayam', createSwayamCollector);
  collectRightGold();
}

io.on('connection', (socket) => {
  socket.emit('snapshot', buildSnapshot());
});

app.get('/api/snapshot', (_req, res) => {
  res.json(buildSnapshot());
});

server.listen(PORT, () => {
  console.log(`Mahakali Jewellers running on ${PORT}`);
  startCollectors();
});

process.on('SIGINT', async () => {
  try { gopnathSource?.stop?.(); } catch (_) {}
  try { swayamSource?.stop?.(); } catch (_) {}
  try { await rightgoldCollector?.stop?.(); } catch (_) {}
  process.exit(0);
});
