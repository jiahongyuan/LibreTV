// functions/api/sources.js
// Cloudflare Pages 版的内置源清单接口：服务端（边缘）拉订阅 → Base58 解码 → 缓存。
// 与 Node 版 server.mjs 的 GET /api/sources 行为一致，客户端不需要改。
import { normalizeSubscription } from '../../scripts/lib/sources.mjs';
import bundled from '../../data/sources.json';

const DEFAULT_SUBSCRIPTION = 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.txt';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const subscriptionUrl = env.SUBSCRIPTION_URL || DEFAULT_SUBSCRIPTION;

  const cache = caches.default;
  const cacheKey = new Request(new URL('/__sources-cache', request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return json(await cached.json(), 200, { 'X-Sources-Origin': 'cache' });
  }

  try {
    const resp = await fetch(subscriptionUrl, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { sources, cacheTime } = normalizeSubscription(await resp.text());
    const body = {
      ok: true,
      origin: 'live',
      updatedAt: new Date().toISOString(),
      count: Object.keys(sources).length,
      sources,
    };
    context.waitUntil(
      cache.put(cacheKey, new Response(JSON.stringify(body), {
        headers: { 'Cache-Control': `max-age=${Math.max(300, cacheTime)}` },
      }))
    );
    return json(body);
  } catch (err) {
    // 拉不到订阅时回落到构建期写进仓库的兜底清单
    const sources = bundled && bundled.sources ? bundled.sources : null;
    if (sources) {
      return json({
        ok: true,
        origin: 'bundled',
        updatedAt: bundled.updatedAt || null,
        count: Object.keys(sources).length,
        sources,
        warning: `订阅拉取失败，使用内置兜底清单：${err.message}`,
      });
    }
    return json({ ok: false, error: `订阅拉取失败: ${err.message}` }, 503);
  }
}
