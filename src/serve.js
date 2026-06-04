'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Starts a local update server for testing LivePatch updates.
 */
function startUpdateServer(options = {}) {
  const dir = path.resolve(options.dir || '.livepatch-output');
  const port = options.port || 4200;

  if (!fs.existsSync(dir)) {
    throw new Error(`Output directory not found: ${dir}\nRun "livepatch push" first.`);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${dir}\nRun "livepatch push" first.`);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === '/check') {
        const platform = url.searchParams.get('platform') || 'android';
        const channel = url.searchParams.get('channel') || 'production';
        const currentVersion = url.searchParams.get('currentVersion') || '0';

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          const bundle = manifest.bundles[platform];

          if (!bundle || manifest.channel !== channel || manifest.version === currentVersion) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ available: false }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            version: manifest.version,
            url: `http://${getLocalIP()}:${port}/bundle/${platform}`,
            hash: bundle.hash,
            size: bundle.size,
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      const bundleMatch = url.pathname.match(/^\/bundle\/(android|ios)$/);
      if (bundleMatch) {
        const bundlePath = path.join(dir, `${bundleMatch[1]}.jsbundle`);
        if (!fs.existsSync(bundlePath)) { res.writeHead(404); res.end('Not found'); return; }
        const stats = fs.statSync(bundlePath);
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Content-Length': stats.size });
        fs.createReadStream(bundlePath).pipe(res);
        return;
      }

      if (url.pathname === '/manifest') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        fs.createReadStream(manifestPath).pipe(res);
        return;
      }

      res.writeHead(404); res.end('Not Found');
    });

    server.on('error', (err) => reject(err));
    server.listen(port, '0.0.0.0', () => {
      resolve({ server, url: `http://${getLocalIP()}:${port}`, port });
    });
  });
}

function getLocalIP() {
  const os = require('os');
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (!addr.internal && addr.family === 'IPv4' && !addr.address.startsWith('127.')) return addr.address;
    }
  }
  return 'localhost';
}

module.exports = { startUpdateServer };
