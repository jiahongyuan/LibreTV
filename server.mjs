import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 静态资源根目录：
 * 优先使用构建产物 dist/（面向 iOS 13.1 / Safari 13.1 的降级版本），
 * 若尚未构建则回退到源码目录，保证 `node server.mjs` 仍可直接启动。
 * 正式部署前请先执行 `npm run build`。
 */
const staticRoot = fs.existsSync(path.join(__dirname, 'dist', 'index.html'))
  ? path.join(__dirname, 'dist')
  : __dirname;

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

function sha256Hash(input) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    resolve(hash.digest('hex'));
  });
}

/**
 * 给 HTML 里的本地 js/css 引用追加基于文件 mtime 的版本号。
 * express.static 对 js/css 用的是 CACHE_MAX_AGE（默认 1d），
 * 若不加版本号，部署新代码后浏览器仍会跑缓存里的旧脚本。
 */
function versionLocalAssets(html) {
  return html.replace(/(href|src)="((?:js|css)\/[^"?]+)"/g, (match, attr, rel) => {
    try {
      const stat = fs.statSync(path.join(staticRoot, rel));
      return `${attr}="${rel}?v=${Math.floor(stat.mtimeMs).toString(36)}"`;
    } catch {
      return match;
    }
  });
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  // ⚠️ 绝不再把 sha256(PASSWORD) 内联进 HTML。
  // 那个哈希本身就是 /proxy 的鉴权令牌（?auth=），内联等于把代理令牌
  // 公开给任何一个访客 —— 密码门形同虚设、代理等于开放代理。
  // 现在只注入一个布尔值；真正的令牌由 POST /api/login 在密码正确后下发。
  content = content.replace('{{PASSWORD_PROTECTED}}', password !== '' ? 'true' : 'false');
  // 兼容其它部署平台（CF/Netlify/Vercel 的中间件会替换这个占位符）；
  // Node/Docker 部署一律留空，不留任何哈希。
  content = content.replace('{{PASSWORD}}', '');
  // HTML 本身必须每次校验（见下方 Cache-Control: no-cache），
  // 而它引用的 js/css 用版本号强制刷新
  return versionLocalAssets(content);
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(staticRoot, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(staticRoot, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath, config.password);
    // HTML 每次都回源校验（ETag 命中时仍是 304，开销极小），
    // 否则浏览器会用缓存里的 HTML 继续引用旧版本的 js/css
    res.setHeader('Cache-Control', 'no-cache');
    res.send(content);
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(staticRoot, 'index.html');
    const content = await renderPage(filePath, config.password);
    // HTML 每次都回源校验（ETag 命中时仍是 304，开销极小），
    // 否则浏览器会用缓存里的 HTML 继续引用旧版本的 js/css
    res.setHeader('Cache-Control', 'no-cache');
    res.send(content);
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

/**
 * SSRF 防护
 * ------------------------------------------------------------------
 * 旧实现按「字符串前缀」比对 hostname，实测有两个绕过：
 *   - `http://[::1]:8899/`：方括号形式不在黑名单里 → 真的发起了连接
 *   - `http://169.254.169.254/opc/v1/instance/`：云元数据地址完全不在名单
 * 现在改为：解析后按 IP 段判断（IPv4 + IPv6 + IPv4-mapped），域名交给 DNS
 * 解析后判断，并用自定义 lookup 让「实际连接用的地址」再过一遍同样的检查
 * （防 DNS rebinding / 重定向到内网）。
 */
const BLOCKED_HOSTNAMES = new Set(
  (process.env.BLOCKED_HOSTS ||
    'localhost,localhost.localdomain,ip6-localhost,ip6-loopback,metadata.google.internal')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;              // link-local（含 169.254.169.254 云元数据）
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试段
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
    if (a >= 224) return true;                            // 组播 / 保留
    return false;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA
    const mapped = s.match(/^::ffff:(.+)$/);
    if (mapped) {
      const rest = mapped[1];
      if (net.isIPv4(rest)) return isPrivateIp(rest);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const n = (((parseInt(hex[1], 16) << 16) >>> 0) | parseInt(hex[2], 16)) >>> 0;
        return isPrivateIp([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
      }
    }
    return false;
  }
  return true; // 不是 IP
}

function normalizeHost(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

function isValidUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false; // 禁止 http://user:pass@host
  const host = normalizeHost(parsed.hostname);
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  return true; // 域名：真正把关的是 safeLookup（解析结果）
}

// 让「实际连接使用的地址」也过检查：DNS 解析到内网/保留地址一律拒绝
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options || {};
  dns.lookup(hostname, opts, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    for (const item of list) {
      if (isPrivateIp(normalizeHost(item.address))) {
        return cb(new Error('BLOCKED_ADDRESS: 目标解析到内网/保留地址'));
      }
    }
    return cb(null, address, family);
  });
}

const proxyHttpAgent = new http.Agent({ keepAlive: false, lookup: safeLookup });
const proxyHttpsAgent = new https.Agent({ keepAlive: false, lookup: safeLookup });

// 豆瓣图床（img*.doubanio.com / *.douban.com）有防盗链：
//   - 不带 Referer            → HTTP 418
//   - 带非豆瓣站点的 Referer  → HTTP 403
//   - Referer = https://movie.douban.com/ → HTTP 200
// 浏览器无法为 <img> 指定 Referer，必须由代理代劳。
function isDoubanHost(hostname) {
  return /(^|\.)(doubanio\.com|douban\.com|doubanusercontent\.com)$/i.test(hostname || '');
}

function buildUpstreamHeaders(targetUrl) {
  const headers = { 'User-Agent': config.userAgent };
  try {
    const { hostname } = new URL(targetUrl);
    if (isDoubanHost(hostname)) {
      headers['Referer'] = 'https://movie.douban.com/';
    }
  } catch {
    // 非法 URL 交给后续校验处理
  }
  return headers;
}

// 验证代理请求的鉴权
/**
 * 登录接口：密码只在服务端校验，成功后下发 /proxy 需要的鉴权令牌。
 * 令牌 = sha256(PASSWORD)（与旧实现一致，其它平台仍沿用），
 * 区别是它不再内联在 HTML 里，必须先通过本接口验证密码才能拿到。
 */
// ---------------- 会话令牌 ----------------
// 不再把 sha256(PASSWORD) 当令牌用（它既是口令哈希又能离线爆破），
// 改成「带过期时间的 HMAC」：<exp>.<hmac>，HttpOnly Cookie 下发。
// 无状态（服务端不存 session），重启不失效，泄露了也会自己过期。
const SESSION_COOKIE = 'ltv_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天

function sessionSecret() {
  return crypto.createHash('sha256')
    .update(String(config.password) + '|libretv-proxy-session-v1')
    .digest();
}

function makeSessionToken(exp) {
  const mac = crypto.createHmac('sha256', sessionSecret())
    .update(String(exp)).digest('hex').slice(0, 32);
  return `${exp}.${mac}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return false;
  const m = token.match(/^(\d{13})\.([0-9a-f]{32})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  return timingSafeEqualStr(token, makeSessionToken(exp));
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function sessionFromRequest(req) {
  const raw = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  return raw && verifySessionToken(raw) ? raw : null;
}

function isHttpsRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

// 兼容开关：其它部署平台（CF/Netlify/Vercel）仍走 URL 里的 ?auth=，
// Node/Docker 部署默认关掉，令牌只走 Cookie。
const ALLOW_URL_AUTH = process.env.ALLOW_URL_AUTH === 'true';

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function loginRateLimited(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) return false;
  return rec.failures >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) loginAttempts.set(ip, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
  else rec.failures += 1;
}

app.post('/api/login', express.json({ limit: '1kb' }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
    req.socket.remoteAddress || 'unknown';

  if (loginRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: '尝试过于频繁，请稍后再试' });
  }
  if (!config.password) {
    return res.status(400).json({ ok: false, error: '服务器未设置 PASSWORD' });
  }

  const supplied = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!timingSafeEqualStr(supplied, config.password)) {
    recordLoginFailure(ip);
    console.warn('登录失败：密码不正确'); // 只记结果，不记任何密码/哈希
    return res.status(401).json({ ok: false, error: '密码错误' });
  }

  loginAttempts.delete(ip);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const cookie = [
    `${SESSION_COOKIE}=${makeSessionToken(expiresAt)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isHttpsRequest(req) ? 'Secure' : null,
  ].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', cookie);
  // 不再把任何哈希交给前端
  res.json({ ok: true, expiresAt: expiresAt });
});

// 供前端在启动时确认「浏览器里到底还有没有有效会话」
app.get('/api/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: !!sessionFromRequest(req) });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` +
    (isHttpsRequest(req) ? '; Secure' : ''));
  res.json({ ok: true });
});

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function validateProxyAuth(req) {
  // ① 主路径：HttpOnly Cookie 里的会话令牌。
  //    令牌不进 URL，所以不会漏进浏览器历史 / 服务端日志 / Referer / CDN 日志，
  //    而且带过期时间（90 天）——泄露了也会自己失效。
  if (sessionFromRequest(req)) {
    return true;
  }

  // ② 兼容路径：?auth=<sha256(PASSWORD)>，仅供其它部署平台（CF/Netlify/Vercel）使用。
  //    Node/Docker 部署默认关闭（ALLOW_URL_AUTH 未设置即为关闭）。
  if (!ALLOW_URL_AUTH) {
    console.warn('代理请求鉴权失败：无有效会话');
    return false;
  }

  const authHash = req.query.auth;
  const timestamp = req.query.t;
  
  // 获取服务器端密码哈希
  const serverPassword = config.password;
  if (!serverPassword) {
    console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
    return false;
  }
  
  // 使用 crypto 模块计算 SHA-256 哈希
  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  
  if (!authHash || !timingSafeEqualStr(authHash, serverPasswordHash)) {
    // ⚠️ 绝不把期望的哈希打进日志：它就是代理口令本身。
    console.warn('代理请求鉴权失败：令牌不匹配');
    return false;
  }
  
  // 验证时间戳（10分钟有效期）
  if (timestamp) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10分钟
    if (now - parseInt(timestamp) > maxAge) {
      console.warn('代理请求鉴权失败：时间戳过期');
      return false;
    }
  }
  
  return true;
}

// 代理访问日志：只记一行，用于定位「某台设备/某几张封面为什么不出来」。
// 日志里能看出：请求的目标 URL、返回状态码、客户端 UA。
// 注意：不要把 auth/t 参数写进日志。
app.use('/proxy', (req, res, next) => {
  const target = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/proxy\//, '')).slice(0, 110);
  const ua = (req.headers['user-agent'] || '').slice(0, 48);
  res.on('finish', () => {
    console.log(`[proxy] ${res.statusCode} ${target} | ua=${ua}`);
  });
  next();
});

app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    // 验证鉴权
    if (!validateProxyAuth(req)) {
      return res.status(401).json({
        success: false,
        error: '代理访问未授权：请检查密码配置或鉴权参数'
      });
    }

    const encodedUrl = req.params.encodedUrl;
    const targetUrl = decodeURIComponent(encodedUrl);

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      return res.status(400).send('无效的 URL');
    }

    log(`代理请求: ${targetUrl}`);

    // 添加请求超时和重试逻辑
    const maxRetries = config.maxRetries;
    let retries = 0;
    
    const makeRequest = async () => {
      try {
        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: config.timeout,
          headers: buildUpstreamHeaders(targetUrl),
          // 自定义 DNS lookup：解析结果落在内网/保留地址就直接拒绝
          httpAgent: proxyHttpAgent,
          httpsAgent: proxyHttpsAgent,
          maxRedirects: 3
        });
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          log(`重试请求 (${retries}/${maxRetries}): ${targetUrl}`);
          return makeRequest();
        }
        throw error;
      }
    };

    const response = await makeRequest();

    // 转发响应头（过滤敏感头）
    const headers = { ...response.headers };
    const sensitiveHeaders = (
      process.env.FILTERED_HEADERS || 
      'content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin'
    ).split(',');
    
    sensitiveHeaders.forEach(header => delete headers[header]);

    // 同源代理若把上游的 text/html 原样回给浏览器，等于给本站开了 XSS 后门。
    // 项目只需要 JSON / 图片 / 视频 / m3u8，HTML 一律降级成纯文本。
    if (typeof headers['content-type'] === 'string' &&
        headers['content-type'].toLowerCase().includes('text/html')) {
      headers['content-type'] = 'text/plain; charset=utf-8';
    }

    res.set(headers);

    // 管道传输响应流
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error.message);
    if (error.response) {
      res.status(error.response.status || 500);
      error.response.data.pipe(res);
    } else {
      res.status(500).send(`请求失败: ${error.message}`);
    }
  }
});

app.use(express.static(staticRoot, {
  maxAge: config.cacheMaxAge,
  setHeaders: (res, filePath) => {
    // js/css 一律每次回源校验（命中 ETag 就是 304，开销极小）。
    // 原因：客户端可能还缓存着「不带 ?v= 版本号」的旧 HTML，
    // 它会请求 /js/douban.js 这种无版本号地址；若这里按 CACHE_MAX_AGE 缓存一天，
    // 部署新代码后那台客户端会一直跑旧脚本（实测事故：封面又全部不显示）。
    if (/\.(?:js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    console.log('用户登录密码已设置');
  } else {
    console.log('警告: 未设置 PASSWORD 环境变量，用户将被要求设置密码');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '' });
  }
});
