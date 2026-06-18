const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createGopnathCollector } = require('./adapters/gopnath');
const { createSwayamCollector } = require('./adapters/swayam');
const { createRightGoldCollector } = require('./adapters/rightgold');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/Media', express.static(path.join(__dirname, 'Media')));

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

function toNum(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).replace(/[^\d.-]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
    .trim();
}

function standardizeItem(item, sourceKey) {
  const symbol = symbolOf(item);
  return {
    symbol,
    name: nameOf(item) || symbol.toUpperCase(),
    buy: toNum(item?.Buy ?? item?.buy ?? item?.Bid ?? item?.bid),
    sell: toNum(item?.Sell ?? item?.sell ?? item?.Ask ?? item?.ask),
    high: toNum(item?.High ?? item?.high),
    low: toNum(item?.Low ?? item?.low),
    open: toNum(item?.Open ?? item?.open),
    close: toNum(item?.Close ?? item?.close),
    ltp: toNum(item?.LTP ?? item?.ltp),
    source: sourceKey,
  };
}

const state = {
  gopnath: { connected: false, lastSeen: null, items: [], map: {}, error: null },
  swayam: { connected: false, lastSeen: null, items: [], map: {}, error: null },
  rightgold: { connected: false, lastSeen: null, gold: [], silver: [], error: null },
};

function publish() {
  io.emit('snapshot', buildSnapshot());
}

function chooseBaseRate(item) {
  if (!item) return null;
  return item.sell ?? item.buy ?? item.ltp ?? item.close ?? item.open ?? null;
}

function bestMatch(items, patterns) {
  for (const pattern of patterns) {
    const found = items.find((it) => pattern.test(it.name) || pattern.test(it.symbol));
    if (found) return found;
  }
  return null;
}

function buildGoldProducts(items) {
  const wanted = ['999 imp rtgs', 'reff only l', 'reff only imp'];
  const selected = [];
  for (const key of wanted) {
    const found = items.find((it) => it.name.toLowerCase().includes(key));
    if (found) selected.push(found);
  }
  if (!selected.length) {
    selected.push(...items.filter((it) => /gold|imp|reff/i.test(it.name)).slice(0, 3));
  }
  return selected;
}

function buildSilverProducts(items) {
  const wanted = ['98.s ref+gst', '98.s rtgs', 'silver 999+gst', 'silver peti rtgs'];
  const selected = [];
  for (const key of wanted) {
    const found = items.find((it) => it.name.toLowerCase().includes(key));
    if (found) selected.push(found);
  }
  if (!selected.length) {
    selected.push(...items.filter((it) => /silver|gst|peti|ref/i.test(it.name)).slice(0, 4));
  }
  return selected;
}

function formatSeries(label, item) {
  if (!item) return [];
  const val = item.sell ?? item.buy ?? item.ltp ?? item.close ?? item.open ?? null;
  return [{
    name: label,
    buy: item.buy,
    sell: item.sell ?? item.buy ?? item.ltp ?? null,
    high: item.high,
    low: item.low,
    price: val,
  }];
}

function buildSnapshot() {
  const gItems = Object.values(state.gopnath.map || {});
  const sItems = Object.values(state.swayam.map || {});
  const goldProducts = buildGoldProducts(gItems);
  const silverProducts = buildSilverProducts(sItems);
  const baseItem = goldProducts.find((it) => it.name.toLowerCase().includes('999 imp rtgs')) || goldProducts[0];
  const baseRate = chooseBaseRate(baseItem);

  const karats = [24, 22, 21, 20, 18, 14, 10, 9].map((k) => {
    const rate = baseRate ? Math.round(baseRate * (k / 24)) : null;
    return {
      label: `${k}K`,
      rate,
      high: rate ? Math.round(rate * 1.01) : null,
      low: rate ? Math.round(rate * 0.99) : null,
      note: k === 24 ? 'LIVERATE' : 'LIVE',
    };
  });

  const goldFuture = bestMatch(gItems, [/goldnext/i, /xau\/usd/i, /future/i, /\bgold\b/i]);
  const goldSpot = bestMatch(gItems, [/inrspot/i, /xau\/usd/i, /spot/i, /\bgold\b/i]);
  const silverFuture = bestMatch(sItems, [/silvernext/i, /xag\/usd/i, /future/i, /\bsilver\b/i]);
  const silverSpot = bestMatch(sItems, [/inrspot/i, /xag\/usd/i, /spot/i, /\bsilver\b/i]);

  return {
    meta: {
      updatedAt: new Date().toISOString(),
      gopnathUpdatedAt: state.gopnath.lastSeen,
      swayamUpdatedAt: state.swayam.lastSeen,
      rightgoldUpdatedAt: state.rightgold.lastSeen,
      goldConnected: state.gopnath.connected,
      silverConnected: state.swayam.connected,
      coinConnected: state.rightgold.connected,
    },
    gold: {
      karats,
      rates: goldProducts,
      future: formatSeries('GOLD FUTURE', goldFuture),
      spot: formatSeries('GOLD SPOT', goldSpot),
    },
    silver: {
      products: silverProducts,
      future: formatSeries('SILVER FUTURE', silverFuture),
      spot: formatSeries('SILVER SPOT', silverSpot),
    },
    coins: {
      gold: state.rightgold.gold,
      silver: state.rightgold.silver,
    },
  };
}

function handleFeed(sourceKey, data) {
  const items = normalizeFeed(data).map((row) => standardizeItem(row, sourceKey));
  if (!items.length) return;
  state[sourceKey].items = items;
  state[sourceKey].map = Object.fromEntries(items.filter((it) => it.symbol).map((it) => [it.symbol, it]));
  state[sourceKey].lastSeen = new Date().toISOString();
  state[sourceKey].connected = true;
  publish();
}

function attachSource(sourceKey, factory) {
  return factory({
    onConnect() {
      state[sourceKey].connected = true;
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

async function startCoinCollector() {
  const collector = createRightGoldCollector({
    url: process.env.RIGHTGOLD_URL || 'https://chawlajewellers.com/coinrate-iframe',
    onResult(payload) {
      state.rightgold.connected = true;
      state.rightgold.lastSeen = new Date().toISOString();
      state.rightgold.gold = payload.gold || [];
      state.rightgold.silver = payload.silver || [];
      publish();
    },
    onError(err) {
      state.rightgold.connected = false;
      state.rightgold.error = err?.message || String(err);
      publish();
    },
  });

  await collector.start();
  const intervalMs = Number(process.env.RIGHTGOLD_POLL_MS || 45000);
  setInterval(() => collector.scrape().catch(() => {}), intervalMs);
}

io.on('connection', (socket) => {
  socket.emit('snapshot', buildSnapshot());
});

(async () => {
  attachSource('gopnath', createGopnathCollector);
  attachSource('swayam', createSwayamCollector);
  await startCoinCollector();
  server.listen(PORT, () => console.log(`Mahakali Jewellers listening on ${PORT}`));
})();
