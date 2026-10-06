/**
 * Cloudflare Pages 版会话令牌（WebCrypto，与 Node 版 server.mjs 语义一致）
 * ------------------------------------------------------------------
 * 令牌 = <exp(13位毫秒)>.<HMAC-SHA256(sha256(PASSWORD+'|libretv-proxy-session-v1'), exp) 前 32 位>
 * 无状态、带过期时间，放在 HttpOnly + SameSite=Lax + Secure 的 Cookie 里。
 * 与 Node 版的区别只是用 WebCrypto 代替 node:crypto。
 */
export const SESSION_COOKIE_NAME = 'ltv_session';
export const SESSION_TTL_SEC = 90 * 24 * 60 * 60; // 90 天

const encoder = new TextEncoder();

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(String(text))));
}

async function hmacHex(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(String(message))));
}

async function sessionKey(password) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${password}|libretv-proxy-session-v1`));
  return new Uint8Array(digest);
}

/** 定长比较，避免时序侧信道 */
export function constantTimeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeSessionToken(password, exp) {
  const mac = await hmacHex(await sessionKey(password), exp);
  return `${exp}.${mac.slice(0, 32)}`;
}

export async function verifySessionToken(password, token) {
  if (typeof token !== 'string') return false;
  const m = token.match(/^(\d{13})\.([0-9a-f]{32})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  return constantTimeEqual(token, await makeSessionToken(password, exp));
}

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

/** 请求里是否带着有效会话（env.PASSWORD 未设置时一律 false） */
export async function sessionFromRequest(request, env) {
  if (!env || !env.PASSWORD) return false;
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE_NAME];
  if (!token) return false;
  return verifySessionToken(env.PASSWORD, token);
}

export function sessionCookieHeader(token, maxAgeSec = SESSION_TTL_SEC) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}; Secure`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`;
}
