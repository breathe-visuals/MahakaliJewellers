const { io: createClient } = require('socket.io-client');
const pako = require('pako');

function createGopnathCollector(handlers = {}) {
  const socket = createClient(process.env.GOPNATH_SOCKET_URL || 'https://starlinesupport.in:10001', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    rejectUnauthorized: false,
  });

  const room = process.env.GOPNATH_ROOM || 'gopnathrefinery';

  socket.on('connect', () => {
    try {
      socket.emit('room', room);
      socket.emit('Client', room);
    } catch (_) { }
    handlers.onConnect && handlers.onConnect();
  });

  socket.on('disconnect', () => handlers.onDisconnect && handlers.onDisconnect());
  socket.on('connect_error', (err) => handlers.onError && handlers.onError(err));

  const forward = (payload) => {
    const decoded = decodePayload(payload);
    const items = normalizeArray(decoded);
    handlers.onData && handlers.onData(items);
  };

  socket.on('message', forward);
  socket.on('Liverate', forward);
  socket.on('data', forward);
  socket.on('ClientData', forward);

  return {
    stop() {
      socket.close();
    },
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
    const keys = ['data', 'items', 'rows', 'products', 'Rate', 'rate'];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
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

module.exports = { createGopnathCollector };