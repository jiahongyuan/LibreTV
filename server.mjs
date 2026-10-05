import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
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
  if (password !== '') {
    const sha256 = await sha256Hash(password);
    content = content.replace('{{PASSWORD}}', sha256);
  } else {
    content = content.replace('{{PASSWORD}}', '');
  }
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

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    
    // 从环境变量获取阻止的主机名列表
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    
    // 从环境变量获取阻止的 IP 前缀
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    if (blockedHostnames.includes(parsed.hostname)) return false;
    
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

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
function validateProxyAuth(req) {
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
  
  if (!authHash || authHash !== serverPasswordHash) {
    console.warn('代理请求鉴权失败：密码哈希不匹配');
    console.warn(`期望: ${serverPasswordHash}, 收到: ${authHash}`);
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
          headers: buildUpstreamHeaders(targetUrl)
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
