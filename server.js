// GARGANTUA — zero-dependency static server.
// - Serves the project files (no build step required).
// - POST /shot   -> receives { png: "data:image/png;base64,..." } from the
//                   page's URL screenshot-automation interface, saves it to
//                   ./shots/shot_<timestamp>.png
// - POST /log    -> receives { errors, warnings, url } and appends them to
//                   ./shots/console.log (used by headless verification)
//
// Usage:  node server.js [port]     (default 8080)

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glsl': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

fs.mkdirSync(path.join(root, 'shots'), { recursive: true });

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // --- screenshot receiver -------------------------------------------------
  if (req.method === 'POST' && urlPath === '/shot') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 32e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j.png || typeof j.png !== 'string') throw new Error('missing png');
        const b64 = j.png.replace(/^data:image\/png;base64,/, '');
        const name = j.name ? String(j.name).replace(/[^a-zA-Z0-9_-]/g, '_') : null;
        const file = path.join(root, 'shots', (name ? 'shot_' + name : 'shot_' + Date.now()) + '.png');
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        const meta = {
          ok: true,
          file: path.basename(file),
          bytes: Buffer.from(b64, 'base64').length,
          quality: j.quality || null,
          params: j.params || null,
        };
        console.log('[shot] saved', path.basename(file));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(meta));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // --- console log receiver -------------------------------------------------
  if (req.method === 'POST' && urlPath === '/log') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      try {
        const line = '[' + new Date().toISOString() + '] ' + body + '\n';
        fs.appendFileSync(path.join(root, 'shots', 'console.log'), line);
        console.log('[log] received', body.length, 'bytes');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // --- static files ---------------------------------------------------------
  const p = urlPath === '/' ? '/index.html' : urlPath;
  const fp = path.normalize(path.join(root, p));
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 not found: ' + p);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('GARGANTUA server running at http://localhost:' + PORT);
  console.log('Screenshot endpoint:  POST http://localhost:' + PORT + '/shot');
  console.log('Log endpoint:         POST http://localhost:' + PORT + '/log');
});
