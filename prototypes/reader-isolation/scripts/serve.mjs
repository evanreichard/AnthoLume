import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([['/', ['dist/index.html', 'text/html']], ['/app.js', ['dist/app.js', 'text/javascript']], ['/viewer.js', ['dist/viewer.js', 'text/javascript']]]);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1:5318').pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (path === '/credential-target.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><body><script>let access;try{parent.document.body.dataset.pwned="yes";localStorage.setItem("credential","stolen");access=true}catch(e){access=false}parent.postMessage({type:"navigation-probe",access,origin:self.origin},"*")</script>');
    return;
  }
  let file = files.get(path);
  if (/^\/fixtures\/[a-z-]+\.epub$/.test(path)) file = ['public' + path, 'application/epub+zip'];
  if (!file) {res.writeHead(404); res.end(); return;}
  try {res.setHeader('Content-Type', file[1]);res.end(await readFile(file[0]));}
  catch {res.writeHead(404);res.end();}
});
server.listen(5318, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
