import { once } from 'node:events';
import { createConnection } from 'node:net';
import { test, expect } from './fixtures';

test('the fixture shuts down cleanly while a browser preconnection has sent no headers', async ({
  server,
  request,
}) => {
  const url = new URL(server.origin);
  const socket = createConnection(Number(url.port), url.hostname);
  try {
    await once(socket, 'connect');
    expect((await request.get(`${server.origin}/api/v1/session`)).status()).toBe(200);
    await server.stop();
  } finally {
    socket.destroy();
  }
});
