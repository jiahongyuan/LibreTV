// functions/api/logout.js
// 退出：清掉会话 Cookie
import { clearSessionCookieHeader } from '../../lib/pages-session.mjs';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookieHeader(),
    },
  });
}
