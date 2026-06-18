const { io: createClient } = require('socket.io-client');

function createSwayamCollector(handlers = {}) {
  const socket = createClient(process.env.SWAYAM_SOCKET || 'https://starlinesolutions.in:10001', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    rejectUnauthorized: false,
  });

  const room = process.env.SWAYAM_ROOM || 'swayamtrading';

  socket.on('connect', () => {
    socket.emit('room', room);
    socket.emit('Client', room);
    handlers.onConnect && handlers.onConnect();
  });
  socket.on('disconnect', () => handlers.onDisconnect && handlers.onDisconnect());
  socket.on('connect_error', (err) => handlers.onError && handlers.onError(err));
  socket.on('message', (data) => handlers.onData && handlers.onData(data));
  socket.on('Liverate', (data) => handlers.onData && handlers.onData(data));

  return { stop() { socket.close(); } };
}

module.exports = { createSwayamCollector };
