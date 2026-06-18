const { io: createClient } = require('socket.io-client');
const pako = require('pako');

const SOCKET_URL = process.env.RIGHTGOLD_SOCKET_URL || 'https://b2.starlinedashboard.in:10001';
const PROJECT = process.env.RIGHTGOLD_PROJECT || 'rightgold';

function createRightGoldCollector(handlers = {}) {
  const socket = createClient(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    rejectUnauthorized: false,
  });

  socket.on('connect', () => {
    try {
      socket.emit('client', PROJECT);
    } catch (_) { }
    handlers.onConnect && handlers.onConnect();
  });

  socket.on('disconnect', () => handlers.onDisconnect && handlers.onDisconnect());
  socket.on('connect_error', (err) => handlers.onError && handlers.onError(err));

  socket.on('coinProducts', (payload) => {
    const items = normalizeArray(decodePayload(payload));
    handlers.onCoins && handlers.onCoins(splitCoins(items));
  });

  socket.on('mainProducts', (payload) => {
    const items = normalizeArray(decodePayload(payload));
    handlers.onMainProducts && handlers.onMainProducts(items);
  });

  socket.on('referanceProducts', (payload) => {
    const items = normalizeArray(decodePayload(payload));
    handlers.onReferenceProducts && handlers.onReferenceProducts(items);
  });

  return {
    stop() {
      socket.close();
    },
  };
}

function splitCoins(items) {
  const goldCoins = [];
  const silverCoins = [];
  const seen = new Set();

  for (const item of items) {
    const name = cleanText(
      item?.name ??
      item?.Name ??
      item?.title ??
      item?.Title ??
      item?.symbol ??
      item?.Symbol
    );

    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const src = cleanText(item?.src ?? item?.source ?? item?.Src ?? item?.Symbol).toLowerCase();
    const price =
      toNum(item?.bid ?? item?.Bid) ??
      toNum(item?.price ?? item?.Price) ??
      toNum(item?.rate ?? item?.Rate) ??
      toNum(item?.ask ?? item?.Ask) ??
      toNum(item?.value ?? item?.Value);

    if (price === null) continue;

    const normalized = {
      name,
      price,
      bid: toNum(item?.bid ?? item?.Bid) ?? price,
      ask: toNum(item?.ask ?? item?.Ask),
      high: toNum(item?.High ?? item?.high),
      low: toNum(item?.Low ?? item?.low),
      src: src || (name.toLowerCase().includes('silver') ? 'silver' : 'gold'),
      raw: item
    };

    if (normalized.src.includes('silver') || /silver/i.test(name)) {
      silverCoins.push(normalized);
    } else {
      goldCoins.push(normalized);
    }
  }

  return {
    goldCoins,
    silverCoins,
    sourceUrl: SOCKET_URL,
    updatedAt: new Date().toISOString()
  };
}

function decodePayload(payload) {
  if (payload == null) return payload;

  if (Array.isArray(payload)) return payload;

  if (typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.coinProducts)) return payload.coinProducts;
  }

  const raw = toUint8Array(payload);
  if (raw) {
    try {
      const text = pako.inflate(raw, { to: 'string' });
      return JSON.parse(text);
    } catch (_) { }
    try {
      const text = pako.ungzip(raw, { to: 'string' });
      return JSON.parse(text);
    } catch (_) { }
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (_) {
      return payload;
    }
  }

  return payload;
}

function normalizeArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  if (typeof payload === 'object') {
    const keys = ['data', 'items', 'rows', 'products', 'coinProducts', 'Rate', 'rate'];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }

  return [];
}

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

function toUint8Array(payload) {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return new Uint8Array(payload);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (payload?.type === 'Buffer' && Array.isArray(payload.data)) {
    return Uint8Array.from(payload.data);
  }
  if (payload?.data instanceof ArrayBuffer) return new Uint8Array(payload.data);
  return null;
}

module.exports = { createRightGoldCollector };