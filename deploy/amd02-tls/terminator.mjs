/**
 * LibreTV TLS 前置层
 * ------------------------------------------------------------------
 * :80  → ACME http-01 挑战（webroot）＋ 其余一律 301 到 https
 * :443 → TLS 终结 + 反向代理到 libretv 容器（http://libretv:8080）
 *
 * 为什么不用 nginx/caddy：
 *   - 证书是 Let's Encrypt 的 IP 证书（shortlived profile，6 天有效期），
 *     所以必须能热加载：这里每 5 分钟看一次 fullchain.pem 的 mtime，
 *     变了就 setSecureContext() 重载，续期后无需重启容器。
 *   - 顺带把 X-Forwarded-Proto/For 传给上游，服务端据此决定是否给 Cookie 加 Secure。
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

const CERT_DIR = process.env.CERT_DIR || '/etc/letsencrypt/live/libretv-ip';
const ACME_ROOT = process.env.ACME_ROOT || '/var/www/acme';
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'libretv';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 8080);
const HSTS_MAX_AGE = Number(process.env.HSTS_MAX_AGE || 86400); // 1 天，够防降级又不至于续期失败时把自己锁死
const CERT_RELOAD_MS = Number(process.env.CERT_RELOAD_MS || 5 * 60 * 1000);

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function readCerts() {
  return {
    key: fs.readFileSync(path.join(CERT_DIR, 'privkey.pem')),
    cert: fs.readFileSync(path.join(CERT_DIR, 'fullchain.pem')),
  };
}

let creds;
try {
  creds = readCerts();
  console.log(`[tls] 已加载证书：${CERT_DIR}`);
} catch (err) {
  console.error(`[tls] 证书读取失败（${CERT_DIR}）：${err.message}`);
  process.exit(1);
}

// ---------------- :443 TLS + 反代 ----------------
const server443 = https.createServer({ key: creds.key, cert: creds.cert }, (req, res) => {
  const headers = { ...req.headers };
  const proto = 'https';
  headers['x-forwarded-proto'] = proto;
  headers['x-forwarded-host'] = headers.host || '';
  headers['x-forwarded-for'] = (headers['x-forwarded-for'] ? headers['x-forwarded-for'] + ', ' : '') +
    (req.socket.remoteAddress || '');
  delete headers['connection'];
  delete headers['keep-alive'];

  const started = Date.now();
  const upstream = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const outHeaders = { ...up.headers };
      for (const h of HOP_BY_HOP) delete outHeaders[h];
      outHeaders['strict-transport-security'] = `max-age=${HSTS_MAX_AGE}`;
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
      res.on('finish', () => {
        console.log(`[tls] ${res.statusCode} ${req.method} ${(req.url || '').slice(0, 90)} ${Date.now() - started}ms`);
      });
    }
  );
  upstream.on('error', (err) => {
    console.error(`[tls] 上游错误：${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('502 上游不可用');
  });
  req.pipe(upstream);
});

// 证书热加载
let lastMtime = 0;
try { lastMtime = fs.statSync(path.join(CERT_DIR, 'fullchain.pem')).mtimeMs; } catch { /* ignore */ }
setInterval(() => {
  try {
    const m = fs.statSync(path.join(CERT_DIR, 'fullchain.pem')).mtimeMs;
    if (m !== lastMtime) {
      server443.setSecureContext(readCerts());
      lastMtime = m;
      console.log('[tls] 检测到证书更新，已热加载');
    }
  } catch (err) {
    console.error(`[tls] 证书热加载检查失败：${err.message}`);
  }
}, CERT_RELOAD_MS);

// ---------------- :80 ACME 挑战 + 301 ----------------
const server80 = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/.well-known/acme-challenge/')) {
    const name = path.basename(url);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      res.writeHead(400); res.end('bad token'); return;
    }
    fs.readFile(path.join(ACME_ROOT, name), (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(buf);
    });
    return;
  }
  const host = (req.headers.host || '').split(':')[0];
  res.writeHead(301, { Location: `https://${host}${url}` });
  res.end();
});

server80.listen(80, () => console.log('[http] :80 就绪（ACME 挑战 + 301 跳转）'));
server443.listen(443, () => console.log(`[tls] :443 就绪 → ${UPSTREAM_HOST}:${UPSTREAM_PORT}`));
