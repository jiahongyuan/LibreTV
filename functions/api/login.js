// functions/api/login.js
// Pages 版登录：密码只在服务端比较，成功后下发 HttpOnly 会话 Cookie。
// 与 Node 版 server.mjs 的 POST /api/login 语义一致（页面里不再内联任何哈希）。
import {
  constantTimeEqual,
  makeSessionToken,
  sessionCookieHeader,
  SESSION_TTL_SEC,
} from '../../lib/pages-session.mjs';

const MAX_FAILURES = 10;
const WINDOW_SEC = 600;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

// 限速：Workers 没有共享内存，用 Cache API 做「同机房尽力而为」的计数
function failureKey(ip) {
  return new Request(`https://libretv.internal/login-fail/${encodeURIComponent(ip)}`, { method: 'GET' });
}

async function failureCount(ip) {
  try {
    const hit = await caches.default.match(failureKey(ip));
    if (!hit) return 0;
    return parseInt((await hit.text()) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

async function recordFailure(ip) {
  try {
    const n = await failureCount(ip);
    await caches.default.put(
      failureKey(ip),
      new Response(String(n + 1), { headers: { 'Cache-Control': `max-age=${WINDOW_SEC}` } })
    );
  } catch {
    /* 计数失败不影响鉴权结果 */
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.PASSWORD) {
    return json({ ok: false, error: '服务器未设置 PASSWORD' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if ((await failureCount(ip)) >= MAX_FAILURES) {
    return json({ ok: false, error: '尝试过于频繁，请稍后再试' }, 429);
  }

  let supplied = '';
  try {
    const body = await request.json();
    if (body && typeof body.password === 'string') supplied = body.password;
  } catch {
    /* 空 body 走下面的失败分支 */
  }

  if (!constantTimeEqual(supplied, env.PASSWORD)) {
    await recordFailure(ip);
    console.warn('登录失败：密码不正确');
    return json({ ok: false, error: '密码错误' }, 401);
  }

  const expiresAt = Date.now() + SESSION_TTL_SEC * 1000;
  const token = await makeSessionToken(env.PASSWORD, expiresAt);
  return json({ ok: true, expiresAt }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
}
