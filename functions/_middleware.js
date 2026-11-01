// 全站门禁 + HTML 占位符替换。
//
// ⚠️ 之前密码只在浏览器端校验：页面、源清单接口谁都能打开。
// 现在 HTML 请求在边缘先验会话，没登录直接跳 /login.html；
// 静态资源放行（登录页要能加载自己的样式），/api/* 各自内部鉴权。
//
// 另：绝不把 sha256(PASSWORD) 注入页面 —— 那东西是 /proxy 的鉴权令牌，
// 内联等于把代理令牌公开给任何访客。这里只给一个布尔值，
// 真正的凭据由 POST /api/login 校验密码后以 HttpOnly Cookie 下发。
import { sessionFromRequest } from '../lib/pages-session.mjs';

// 这些前缀不需要登录：登录页自身、静态资源、API（API 内部各自鉴权）
const OPEN_PREFIX = [
  '/api/',
  '/css/',
  '/js/',
  '/libs/',
  '/image/',
  '/assets/',
  '/login',
  '/login.html',
  '/favicon.ico',
  '/manifest.json',
  '/robots.txt',
  '/service-worker.js',
];

function isOpen(pathname) {
  return OPEN_PREFIX.some((p) => pathname === p || pathname.startsWith(p));
}

// 只有"页面"请求才拦：GET/HEAD 且不是带扩展名的静态文件
function isPageRequest(request, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (/\.[a-z0-9]{1,8}$/i.test(pathname)) return false;
  return true;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (env.PASSWORD && isPageRequest(request, url.pathname) && !isOpen(url.pathname)) {
    let ok = false;
    try {
      ok = await sessionFromRequest(request, env);
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      const target = url.pathname + url.search;
      return Response.redirect(url.origin + '/login.html?next=' + encodeURIComponent(target), 302);
    }
  }

  const response = await next();
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    let html = await response.text();

    html = html.replace('{{PASSWORD_PROTECTED}}', env.PASSWORD ? 'true' : 'false');
    // 兼容其它部署平台（它们的中间件仍会替换这个占位符）；Pages 端一律留空
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
      'window.__ENV__.PASSWORD = "";');

    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
}
