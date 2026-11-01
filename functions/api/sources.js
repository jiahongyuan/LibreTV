// functions/api/sources.js
// Cloudflare Pages 版的内置源清单接口：服务端（边缘）拉订阅 → Base58 解码 → 缓存。
// 与 Node 版 server.mjs 的 GET /api/sources 行为一致，客户端不需要改。
//
// 模式：订阅优先（默认 jingjian.txt，缓存 2 小时，改订阅即改源），
//       拉不到时回落到仓库内置的 data/sources.json。
// 合并：订阅里名字带 🔞 的条目会被标记 adult 并去掉该符号；
//       内置清单里带 adult、订阅里没有的源作为互备追加，避免丢源。
import { sessionFromRequest } from '../../lib/pages-session.mjs';
import { normalizeSubscription } from '../../scripts/lib/sources.mjs';
import bundled from '../../data/sources.json';

const DEFAULT_SUBSCRIPTION = 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jingjian.txt';

// 订阅作者用 🔞 标成人源；少量没标符号的按主机名兜底识别。
const ADULT_MARK = '\u{1F51E}';
const ADULT_HOST_HINT = /(^|\.)(91md\.me|madouse\.la|shayuapi\.com|lbapi9\.com|fhapi9\.com|hsckzy\.xyz|naixxzy\.com)$/i;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

/** 站点标识：忽略协议、大小写、www，用于去重 */
function siteKey(api) {
  try {
    return new URL(api).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(api).toLowerCase();
  }
}

/** 去掉名称里的标记符号，并判定是否为成人源 */
function classify(key, entry) {
  const name = String(entry.name || key);
  const adult = name.includes(ADULT_MARK) || ADULT_HOST_HINT.test(siteKey(entry.api));
  const clean = name.split(ADULT_MARK).join('').replace(/\s{2,}/g, ' ').trim();
  return { api: entry.api, name: clean || key, adult };
}

/** 订阅源 + 内置清单里订阅没有的成人源（互备），按 API 主机去重 */
function mergeWithBundled(subscriptionSources) {
  const merged = {};
  const seen = new Set();
  for (const [key, entry] of Object.entries(subscriptionSources)) {
    const item = classify(key, entry);
    merged[key] = item;
    seen.add(siteKey(item.api));
  }
  const extras = bundled && bundled.sources ? bundled.sources : {};
  for (const [key, entry] of Object.entries(extras)) {
    if (!entry || !entry.adult) continue;
    if (seen.has(siteKey(entry.api))) continue;
    let finalKey = key;
    let n = 2;
    while (merged[finalKey]) finalKey = `${key}_${n++}`;
    merged[finalKey] = classify(finalKey, entry);
    seen.add(siteKey(entry.api));
  }
  return merged;
}

export async function onRequestGet(context) {
  // 和 /proxy 一致：源清单属于站点内容，要求登录会话
  if (!(await sessionFromRequest(context.request, context.env))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const { request, env } = context;

  const subscriptionUrl = env.SUBSCRIPTION_URL || DEFAULT_SUBSCRIPTION;

  const cache = caches.default;
  const cacheKey = new Request(new URL('/__sources-cache-v2', request.url).toString(), { method: 'GET' });
  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';
  const cached = forceRefresh ? null : await cache.match(cacheKey);
  if (cached) {
    return json(await cached.json(), 200, { 'X-Sources-Origin': 'cache' });
  }

  try {
    const resp = await fetch(subscriptionUrl, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { sources, cacheTime } = normalizeSubscription(await resp.text());
    const merged = mergeWithBundled(sources);
    const body = {
      ok: true,
      origin: 'subscription',
      subscription: subscriptionUrl,
      updatedAt: new Date().toISOString(),
      count: Object.keys(merged).length,
      sources: merged,
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
