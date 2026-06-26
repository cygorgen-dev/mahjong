'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8080;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',   '.png': 'image/png', '.json': 'application/json',
};

// ── HTTP: serve static files ───────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(__dirname, '.' + urlPath);
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'ngrok-skip-browser-warning': '1',  // skip ngrok interstitial
    });
    res.end(data);
  });
});

// ── WebSocket: relay host ↔ guest ──────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const clients = {};   // { host: ws, guest: ws }

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      ws.role = msg.role;
      clients[msg.role] = ws;
      ws.send(JSON.stringify({ type: 'registered', role: msg.role }));
      // Notify the other party
      const other = msg.role === 'host' ? clients.guest : clients.host;
      if (other && other.readyState === 1)
        other.send(JSON.stringify({ type: msg.role === 'guest' ? 'guest-joined' : 'host-reconnected' }));
      if (msg.role === 'guest' && clients.host && clients.host.readyState === 1)
        clients.host.send(JSON.stringify({ type: 'guest-joined' }));
      return;
    }

    // Relay to the other party unchanged
    const dest = ws.role === 'host' ? clients.guest : clients.host;
    if (dest && dest.readyState === 1) dest.send(raw.toString());
  });

  ws.on('close', () => {
    if (clients[ws.role] === ws) {
      delete clients[ws.role];
      const other = ws.role === 'host' ? clients.guest : clients.host;
      if (other && other.readyState === 1)
        other.send(JSON.stringify({ type: 'disconnected', role: ws.role }));
    }
  });
});

// ── Listen ─────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const ips = [];
  for (const nets of Object.values(networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  console.log(`\nMahjong MP server on port ${PORT}`);
  console.log(`  Local  : http://localhost:${PORT}`);
  if (ips.length) console.log(`  Friend : http://${ips[0]}:${PORT}`);
  console.log('\nHost opens Local, friend opens Friend URL.\n');
});
