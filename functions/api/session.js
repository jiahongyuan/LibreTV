// functions/api/session.js
// 前端启动时复核「浏览器里还有没有有效会话」
import { sessionFromRequest } from '../../lib/pages-session.mjs';

export async function onRequestGet(context) {
  const { request, env } = context;
  return new Response(JSON.stringify({ ok: await sessionFromRequest(request, env) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
