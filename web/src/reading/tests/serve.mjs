import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const host = '127.0.0.1';
const vite = await createViteServer({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) });
const server = createServer(vite.middlewares);

// Bind Directly - Vite's port 0 probes for an ephemeral port before binding it.
await once(server.listen(0, host), 'listening');
console.log(`Reader test server listening at http://${host}:${server.address().port}`);
