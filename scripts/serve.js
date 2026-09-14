#!/usr/bin/env node
'use strict';
/*
 * serve.js - zero-dependency static file server for local preview.
 *
 *   node scripts/serve.js [dir] [port]
 *
 * Exists so the preview does not depend on python3 being installed (it is not,
 * on a stock Windows machine). It is a preview server only: no caching, no
 * compression, no directory traversal outside `dir`.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || process.env.PORT || 3100);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
};

if (!fs.existsSync(ROOT)) {
  console.error('serve: ' + ROOT + ' does not exist - run `npm run build` first');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let target = path.join(ROOT, path.normalize(url));
  if (path.relative(ROOT, target).startsWith('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat && stat.isDirectory()) {
    target = path.join(target, 'index.html');
    stat = fs.existsSync(target) ? fs.statSync(target) : null;
  }
  if (!stat) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + url);
    console.log('404 ' + url);
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT + '/');
});
