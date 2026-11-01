// functions/api/douban.js
// 批量查豆瓣评分：/api/douban?t=片名1|片名2|...
// 浏览器直连豆瓣会被限流（连续请求直接回空数组），所以放到边缘一次批量查，
// 结果按片名集合做 6 小时边缘缓存。

import { sessionFromRequest } from '../../lib/pages-session.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizeTitle(value) {
  return String(value || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()【】\[\]《》<>·・:：\-—_~～!！?？,，.。'’"“”、|/\\]/g, '')
    .toLowerCase();
}

async function getJson(url, referer) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || 'https://movie.douban.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const text = await resp.text();
  return JSON.parse(text);
}

async function lookup(title) {
  try {
    const suggest = await getJson('https://movie.douban.com/j/subject_suggest?q=' + encodeURIComponent(title));
    if (!Array.isArray(suggest) || !suggest.length) return null;

    const q = normalizeTitle(title);
    let exact = null;
    const loose = [];
    for (const cand of suggest) {
      if (!cand || !cand.id) continue;
      const n = normalizeTitle(cand.title);
      if (n === q) { exact = cand; break; }
      if (n.indexOf(q) === 0 || q.indexOf(n) === 0) loose.push(cand);
    }
    const candidates = exact ? [exact] : loose.slice(0, 3);

    for (const cand of candidates) {
      const abs = await getJson('https://movie.douban.com/j/subject_abstract?subject_id=' + cand.id);
      const rate = parseFloat(abs && abs.subject && abs.subject.rate);
      if (!isNaN(rate) && rate > 0) return rate.toFixed(1);
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  // 这个接口会替调用方去豆瓣批量查分，不设门就成了公开的豆瓣代理
  if (!(await sessionFromRequest(context.request, context.env))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const { request } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get('t') || '';
  const titles = raw.split('|').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 30);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };
  if (!titles.length) return new Response('{}', { status: 400, headers });

  const cache = caches.default;
  const cacheKey = new Request('https://douban-cache.invalid/' + encodeURIComponent(raw), { method: 'GET' });
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (e) { /* 缓存不可用就直接查 */ }

  const out = {};
  const CONCURRENCY = 3;
  for (let i = 0; i < titles.length; i += CONCURRENCY) {
    const batch = titles.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async function (t) { out[t] = await lookup(t); }));
  }

  const resp = new Response(JSON.stringify(out), {
    headers: { ...headers, 'Cache-Control': 'public, max-age=21600' },
  });
  try { context.waitUntil(cache.put(cacheKey, resp.clone())); } catch (e) { /* ignore */ }
  return resp;
}
