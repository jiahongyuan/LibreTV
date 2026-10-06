/**
 * 订阅解析共用逻辑（服务端 server.mjs 与 scripts/fetch-sources.mjs 共用）
 *
 * 订阅格式：Base58(JSON)
 *   { "cache_time": 7200,
 *     "api_site": { "<主机名>": { "name": "...", "api": "https://.../api.php/provide/vod", "detail": "..." } } }
 */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(str) {
  let n = 0n;
  for (const ch of String(str)) {
    const i = B58_ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`非法 Base58 字符: ${JSON.stringify(ch)}`);
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = new Uint8Array(hex.length / 2);
  for (let i = 0; i < body.length; i++) body[i] = parseInt(hex.substr(i * 2, 2), 16);
  const leading = String(str).length - String(str).replace(/^1+/, '').length;
  if (!leading) return body;
  const out = new Uint8Array(leading + body.length);
  out.set(body, leading);
  return out;
}

/** 解出订阅的 JSON 文本（Node 与 Cloudflare Workers 通用） */
export function decodeSubscriptionText(raw) {
  const text = String(raw).trim();
  if (!text) throw new Error('订阅内容为空');
  if (text.startsWith('{')) return text;
  return new TextDecoder().decode(base58Decode(text));
}

/**
 * 有些条目被订阅作者套了自己的 CORS 代理：https://pz.v88.qzz.io/?url=<真实地址>
 * 本项目有自己的服务端代理，取里面的真实地址，少绕第三方一跳。
 */
export function unwrapProxy(url) {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get('url');
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch { /* 非法 URL 保持原样，交给调用方判断 */ }
  return url;
}

/** key 规则与历史内置清单保持一致：非字母数字换下划线，数字开头补前导下划线 */
export function keyOf(host, used = new Set()) {
  let key = String(host).trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^(\d)/, '_$1');
  if (!key) key = 'src';
  let final = key;
  let n = 2;
  while (used.has(final)) final = `${key}_${n++}`;
  used.add(final);
  return final;
}

/**
 * 把订阅（Base58 字符串或已解析的对象）规整为 { key: { api, name } }
 * @param {string|object} input
 * @returns {{sources: object, order: string[], cacheTime: number, updatedAt: string}}
 */
export function normalizeSubscription(input) {
  let payload = input;
  if (typeof input === 'string') {
    payload = JSON.parse(decodeSubscriptionText(input));
  }

  const apiSite = payload && payload.api_site;
  if (!apiSite || typeof apiSite !== 'object') throw new Error('订阅里没有 api_site 字段');

  const used = new Set();
  const sources = {};
  const order = [];
  for (const [host, info] of Object.entries(apiSite)) {
    const api = unwrapProxy(String((info && info.api) || '').trim());
    if (!/^https?:\/\//i.test(api)) continue;
    const key = keyOf(host, used);
    sources[key] = { api, name: String((info && info.name) || host).trim() };
    order.push(key);
  }
  if (order.length === 0) throw new Error('订阅解析后一个可用源都没有');

  const cacheTime = Number(payload.cache_time) > 0 ? Number(payload.cache_time) : 7200;
  return { sources, order, cacheTime, updatedAt: new Date().toISOString() };
}
