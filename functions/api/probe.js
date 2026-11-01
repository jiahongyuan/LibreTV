// GET /api/probe?u=<m3u8 url>
// 服务端实测这个源的下载速度：拉播放列表 → 取第一条分片 → 读 256KB → 返回 MB/s。
// 放在服务端做，避免浏览器端被 CORS / Range / 混合内容挡住，
// iOS 原生播放又拿不到任何字节统计，这个接口是唯一可靠的测速来源。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const SAMPLE_BYTES = 262144;
const TIMEOUT_MS = 6000;

function abs(base, u) {
  try {
    return new URL(u, base).toString();
  } catch (e) {
    return u;
  }
}

async function getText(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*', referer: new URL(url).origin + '/' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function firstSegment(text, baseUrl) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    return abs(baseUrl, line);
  }
  return null;
}

import { sessionFromRequest } from '../../lib/pages-session.mjs';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  // 和 /proxy 一样要求登录会话，避免这个接口被当成公开的任意 URL 探测器
  if (!(await sessionFromRequest(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const u = new URL(request.url).searchParams.get('u');
  if (!u) return json({ ok: false, error: 'u required' }, 400);
  if (!/^https?:\/\//i.test(u)) return json({ ok: false, error: 'bad url' }, 400);

  const started = Date.now();
  let playlistUrl = u;
  let text = await getText(playlistUrl, TIMEOUT_MS);
  if (!text) return json({ ok: false, error: 'playlist fetch failed' }, 502);

  // 主播放列表：再进一层拿媒体列表
  for (let depth = 0; depth < 2 && /#EXT-X-STREAM-INF/i.test(text); depth++) {
    const variant = firstSegment(text, playlistUrl);
    if (!variant) break;
    playlistUrl = variant;
    const next = await getText(playlistUrl, TIMEOUT_MS);
    if (!next) break;
    text = next;
  }

  const seg = firstSegment(text, playlistUrl);
  if (!seg) return json({ ok: false, error: 'no segment found' }, 502);

  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  let bytes = 0;
  let total = 0;
  try {
    const r = await fetch(seg, {
      headers: {
        'user-agent': UA,
        accept: '*/*',
        referer: new URL(seg).origin + '/',
        range: 'bytes=0-' + (SAMPLE_BYTES - 1),
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const cr = r.headers.get('content-range') || '';
    total = Number(cr.split('/')[1]) || Number(r.headers.get('content-length')) || 0;
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes >= SAMPLE_BYTES) {
          try { reader.cancel(); } catch (e) {}
          break;
        }
      }
    } else {
      const b = await r.arrayBuffer();
      bytes = b.byteLength;
    }
  } catch (e) {
    // 超时也把已经收到的字节算进去
  } finally {
    clearTimeout(killer);
  }

  const secs = (Date.now() - t0) / 1000;
  if (bytes <= 0 || secs <= 0) {
    return json({ ok: false, error: 'segment fetch failed', seg: seg.slice(0, 120) }, 502);
  }
  return json({
    ok: true,
    mbps: +((bytes / 1048576) / secs).toFixed(2),
    bytes,
    secs: +secs.toFixed(2),
    segSize: total,
    totalMs: Date.now() - started,
  });
}
