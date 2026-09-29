// Optional preview server. The standalone HTML can also be opened directly.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/citrus-vault.svg': 'citrus-vault.svg', '/standalone.html': '酸橙-前端设计参考.html' };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const name = files[new URL(req.url, 'http://127.0.0.1').pathname];
  if (!name) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, name), (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(name)], 'Cache-Control': 'no-store' }); res.end(data);
  });
}).listen(4176, '127.0.0.1', () => console.log('Until a Lime design reference: http://127.0.0.1:4176'));
