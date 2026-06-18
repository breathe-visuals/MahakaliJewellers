const { io: createClient } = require('socket.io-client');

function createGopnathCollector(handlers = {}) {
  const socket = createClient(process.env.GOPNATH_SOCKET || 'https://starlinesupport.in:10001', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    rejectUnauthorized: false,
  });

  const room = process.env.GOPNATH_ROOM || 'gopnathrefinery';

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

module.exports = { createGopnathCollector };
