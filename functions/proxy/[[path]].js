// functions/proxy/[[path]].js
import { sessionFromRequest } from '../../lib/pages-session.mjs';

// --- 配置 (现在从 Cloudflare 环境变量读取) ---
// 在 Cloudflare Pages 设置 -> 函数 -> 环境变量绑定 中设置以下变量:
// CACHE_TTL (例如 86400)
// MAX_RECURSION (例如 5)
// FILTER_DISCONTINUITY (不再需要，设为 false 或移除)
// USER_AGENTS_JSON (例如 ["UA1", "UA2"]) - JSON 字符串数组
// DEBUG (例如 false 或 true)
// PASSWORD (例如 "your_password") - 鉴权密码
// --- 配置结束 ---

// --- 常量 (之前在 config.js 中，现在移到这里，因为它们与代理逻辑相关) ---
const MEDIA_FILE_EXTENSIONS = [
    '.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.f4v', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
    '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.alac', '.aiff', '.opus',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic'
];
const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'image/'];
// --- 常量结束 ---


/**
 * 主要的 Pages Function 处理函数
 * 拦截发往 /proxy/* 的请求
 */
export async function onRequest(context) {
    const { request, env, next, waitUntil } = context; // next 和 waitUntil 可能需要
    const url = new URL(request.url);

    // 验证鉴权（主函数调用）
    const isValidAuth = await validateAuth(request, env);
    if (!isValidAuth) {
        return new Response(JSON.stringify({
            success: false,
            error: '代理访问未授权：请检查密码配置或鉴权参数'
        }), { 
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Content-Type': 'application/json'
            }
        });
    }

    // --- 从环境变量读取配置 ---
    const DEBUG_ENABLED = (env.DEBUG === 'true');
    const CACHE_TTL = parseInt(env.CACHE_TTL || '86400'); // 默认 24 小时
    const MAX_RECURSION = parseInt(env.MAX_RECURSION || '5'); // 默认 5 层
    // ?raw=1：只过滤广告、不把分片改写成 /proxy/...，让播放器直连 CDN 拿分片
    //（走代理转发 ts 会慢 3-5 倍，实测过）
    const RAW_MODE = url.searchParams.get('raw') === '1';
    // 广告过滤已移至播放器处理，代理不再执行
    let USER_AGENTS = [ // 提供一个基础的默认值
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    try {
        // 尝试从环境变量解析 USER_AGENTS_JSON
        const agentsJson = env.USER_AGENTS_JSON;
        if (agentsJson) {
            const parsedAgents = JSON.parse(agentsJson);
            if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
                USER_AGENTS = parsedAgents;
            } else {
                 logDebug("环境变量 USER_AGENTS_JSON 格式无效或为空，使用默认值");
            }
        }
    } catch (e) {
        logDebug(`解析环境变量 USER_AGENTS_JSON 失败: ${e.message}，使用默认值`);
    }
    // --- 配置读取结束 ---


    // --- 辅助函数 ---

    // 验证代理请求的鉴权
    async function validateAuth(request, env) {
        const serverPassword = env.PASSWORD;
        if (!serverPassword) {
            console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
            return false;
        }

        // ① 主路径：HttpOnly Cookie 里的会话令牌（POST /api/login 下发）。
        //    令牌不进 URL，所以不会漏进历史 / 日志 / Referer / 边缘日志。
        if (await sessionFromRequest(request, env)) {
            return true;
        }

        // ② 兼容路径：?auth=<sha256(PASSWORD)>，需显式开启 ALLOW_URL_AUTH=true
        if (env.ALLOW_URL_AUTH !== 'true') {
            console.warn('代理请求鉴权失败：无有效会话');
            return false;
        }

        const url = new URL(request.url);
        const authHash = url.searchParams.get('auth');
        const timestamp = url.searchParams.get('t');

        // 使用 SHA-256 哈希算法（与其他平台保持一致）
        // 在 Cloudflare Workers 中使用 crypto.subtle
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(serverPassword);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const serverPasswordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            if (!authHash || authHash !== serverPasswordHash) {
                console.warn('代理请求鉴权失败：密码哈希不匹配');
                return false;
            }
        } catch (error) {
            console.error('计算密码哈希失败:', error);
            return false;
        }
        
        // 验证时间戳（10分钟有效期）
        if (timestamp) {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10分钟
            if (now - parseInt(timestamp) > maxAge) {
                console.warn('代理请求鉴权失败：时间戳过期');
                return false;
            }
        }
        
        return true;
    }

    // 验证鉴权（主函数调用）
    if (!validateAuth(request, env)) {
        return new Response('Unauthorized', { 
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    }

    // 输出调试日志 (需要设置 DEBUG: true 环境变量)
    function logDebug(message) {
        if (DEBUG_ENABLED) {
            console.log(`[Proxy Func] ${message}`);
        }
    }

    // 从请求路径中提取目标 URL
    function getTargetUrlFromPath(pathname) {
        // 路径格式: /proxy/经过编码的URL
        // 例如: /proxy/https%3A%2F%2Fexample.com%2Fplaylist.m3u8
        const encodedUrl = pathname.replace(/^\/proxy\//, '');
        if (!encodedUrl) return null;
        try {
            // 解码
            let decodedUrl = decodeURIComponent(encodedUrl);

             // 简单检查解码后是否是有效的 http/https URL
             if (!decodedUrl.match(/^https?:\/\//i)) {
                 // 也许原始路径就没有编码？如果看起来像URL就直接用
                 if (encodedUrl.match(/^https?:\/\//i)) {
                     decodedUrl = encodedUrl;
                     logDebug(`Warning: Path was not encoded but looks like URL: ${decodedUrl}`);
                 } else {
                    logDebug(`无效的目标URL格式 (解码后): ${decodedUrl}`);
                    return null;
                 }
             }
             return decodedUrl;

        } catch (e) {
            logDebug(`解码目标URL时出错: ${encodedUrl} - ${e.message}`);
            return null;
        }
    }

    // 创建标准化的响应
    function createResponse(body, status = 200, headers = {}) {
        const responseHeaders = new Headers(headers);
        // 关键：添加 CORS 跨域头，允许前端 JS 访问代理后的响应
        responseHeaders.set("Access-Control-Allow-Origin", "*"); // 允许任何来源访问
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS"); // 允许的方法
        responseHeaders.set("Access-Control-Allow-Headers", "*"); // 允许所有请求头

        // 处理 CORS 预检请求 (OPTIONS) - 放在这里确保所有响应都处理
         if (request.method === "OPTIONS") {
             // 使用下面的 onOptions 函数可以更规范，但在这里处理也可以
             return new Response(null, {
                 status: 204, // No Content
                 headers: responseHeaders // 包含上面设置的 CORS 头
             });
         }

        return new Response(body, { status, headers: responseHeaders });
    }

    // 创建 M3U8 类型的响应
    function createM3u8Response(content, isLive) {
        // 直播清单没有 #EXT-X-ENDLIST，分片一直在滚动：
        // 一旦按 CACHE_TTL 缓存，浏览器就会拿一份过期清单反复请求失效分片，画面直接停住。
        return createResponse(content, 200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": isLive ? 'no-store, no-cache, must-revalidate' : `public, max-age=${CACHE_TTL}`
        });
    }

    // 直播判定：m3u8 里没有 #EXT-X-ENDLIST
    function isLivePlaylist(text) {
        return typeof text === 'string' && /#EXTINF/i.test(text) && !/#EXT-X-ENDLIST/i.test(text);
    }

    // 获取随机 User-Agent
    function getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    // 获取 URL 的基础路径 (用于解析相对路径)
    function getBaseUrl(urlStr) {
        try {
            const parsedUrl = new URL(urlStr);
            // 如果路径是根目录，或者没有斜杠，直接返回 origin + /
            if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
                return `${parsedUrl.origin}/`;
            }
            const pathParts = parsedUrl.pathname.split('/');
            pathParts.pop(); // 移除文件名或最后一个路径段
            return `${parsedUrl.origin}${pathParts.join('/')}/`;
        } catch (e) {
            logDebug(`获取 BaseUrl 时出错: ${urlStr} - ${e.message}`);
            // 备用方法：找到最后一个斜杠
            const lastSlashIndex = urlStr.lastIndexOf('/');
            // 确保不是协议部分的斜杠 (http://)
            return lastSlashIndex > urlStr.indexOf('://') + 2 ? urlStr.substring(0, lastSlashIndex + 1) : urlStr + '/';
        }
    }


    // 将相对 URL 转换为绝对 URL
    function resolveUrl(baseUrl, relativeUrl) {
        // 如果已经是绝对 URL，直接返回
        if (relativeUrl.match(/^https?:\/\//i)) {
            return relativeUrl;
        }
        try {
            // 使用 URL 对象来处理相对路径
            return new URL(relativeUrl, baseUrl).toString();
        } catch (e) {
            logDebug(`解析 URL 失败: baseUrl=${baseUrl}, relativeUrl=${relativeUrl}, error=${e.message}`);
            // 简单的备用方法
            if (relativeUrl.startsWith('/')) {
                // 处理根路径相对 URL
                const urlObj = new URL(baseUrl);
                return `${urlObj.origin}${relativeUrl}`;
            }
            // 处理同级目录相对 URL
            return `${baseUrl.replace(/\/[^/]*$/, '/')}${relativeUrl}`; // 确保baseUrl以 / 结尾
        }
    }

    // 将目标 URL 重写为内部代理路径 (/proxy/...)
    function rewriteUrlToProxy(targetUrl) {
        // 确保目标URL被正确编码，以便作为路径的一部分
        return `/proxy/${encodeURIComponent(targetUrl)}`;
    }

    // 计算上游请求应使用的 Referer
    // 豆瓣图床（img*.doubanio.com 等）有防盗链：不带 Referer → 418，带非豆瓣站点 Referer → 403，
    // 只有 https://movie.douban.com/ 才会放行。前端 <img> 无法自带 Referer，必须由代理补上。
    function getUpstreamReferer(targetUrl) {
        try {
            const host = new URL(targetUrl).hostname;
            if (/(^|\.)(doubanio\.com|douban\.com|doubanusercontent\.com)$/i.test(host)) {
                return 'https://movie.douban.com/';
            }
        } catch (e) {
            // 非法 URL，忽略，走下面的默认逻辑
        }
        // 默认：传递原始 Referer，没有则用目标站点 origin
        return request.headers.get('Referer') || new URL(targetUrl).origin;
    }

    // 获取远程内容及其类型
    // 流式模式：分片/密钥这类"大或要立刻出首字节"的请求，不整块读进内存，
    // 直接把上游的 ReadableStream 交给浏览器 —— 首字节时间从"整片下载完"降到"上游首包"。
    const STREAM_RE = /\.(ts|m4s|mp4|m4a|mp3|aac|key|webm|flv|jpg|jpeg|png|webp)(\?|$)/i;

    // 对冲：请求发出后 hedgeAfterMs 还没拿到响应头，就再发一份（换 UA），
    // 谁先回来用谁，其余立即 abort。只在"慢"的时候才多花钱，
    // 正常分片仍然只有一次上游请求。
    async function fetchHedged(targetUrl, headers, { timeoutMs = 25000, hedgeAfterMs = 1200, maxHedges = 1, cf } = {}) {
        const controllers = [];
        let settled = false;
        let pending = 0;
        let lastErr = null;

        const start = (i) =>
            new Promise((resolve, reject) => {
                const ctrl = new AbortController();
                controllers.push(ctrl);
                const timer = setTimeout(() => {
                    try { ctrl.abort(); } catch {}
                }, timeoutMs);
                const h = new Headers(headers);
                if (i > 0) h.set('User-Agent', getRandomUserAgent());
                fetch(targetUrl, { headers: h, redirect: 'follow', signal: ctrl.signal, cf })
                    .then((r) => {
                        clearTimeout(timer);
                        if (r.status === 429 || r.status >= 500) {
                            try { ctrl.abort(); } catch {}
                            reject(new Error(`HTTP ${r.status}`));
                            return;
                        }
                        resolve({ r, ctrl });
                    })
                    .catch((e) => {
                        clearTimeout(timer);
                        reject(e);
                    });
            });

        return new Promise((resolve, reject) => {
            const launch = (i) => {
                pending++;
                start(i)
                    .then(({ r, ctrl }) => {
                        if (settled) {
                            try { ctrl.abort(); } catch {}
                            return;
                        }
                        settled = true;
                        // 赢家之外的全部掐掉，避免白占上游带宽
                        for (const c of controllers) {
                            if (c !== ctrl) { try { c.abort(); } catch {} }
                        }
                        resolve(r);
                    })
                    .catch((e) => {
                        lastErr = e;
                        pending--;
                        if (!settled && pending === 0) reject(lastErr);
                    });
            };

            launch(0);
            for (let i = 1; i <= maxHedges; i++) {
                setTimeout(() => { if (!settled) launch(i); }, hedgeAfterMs * i);
            }
        });
    }

    async function fetchWithRetry(targetUrl, headers, { attempts = 3, timeoutMs = 20000, cf } = {}) {
        let lastErr = null;
        for (let i = 0; i < attempts; i++) {
            try {
                // 最后一轮不再对冲，老老实实等一次完整响应
                const hedge = i < attempts - 1
                    ? { hedgeAfterMs: Number(env.HEDGE_AFTER_MS || 1200), maxHedges: 1 }
                    : { hedgeAfterMs: 0, maxHedges: 0 };
                return await fetchHedged(targetUrl, headers, { timeoutMs, cf, ...hedge });
            } catch (e) {
                lastErr = e;
                if (i < attempts - 1) await new Promise((res) => setTimeout(res, 200 * (i + 1)));
            }
        }
        throw lastErr || new Error('fetch failed');
    }

    async function fetchContentWithType(targetUrl) {
        const headers = new Headers({
            'User-Agent': getRandomUserAgent(),
            'Accept': '*/*',
            // 尝试传递一些原始请求的头信息
            'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8',
            // Referer：豆瓣等有防盗链的站点需要固定的 Referer
            'Referer': getUpstreamReferer(targetUrl)
        });
        // 透传 Range：Safari 原生播放会对分片发字节范围请求，
        // 不透传就只能整片回，既费流量又拖慢起播
        const clientRange = request.headers.get('Range');
        if (clientRange) headers.set('Range', clientRange);

        const isStream = STREAM_RE.test(targetUrl);
        // 分片交给 Cloudflare 边缘缓存：同一片第二次请求（重看、拖回、多设备）不再回源
        const cfOpts = isStream ? { cacheEverything: true, cacheTtl: 86400, cacheKey: targetUrl } : undefined;

        try {
            logDebug(`开始请求: ${targetUrl}${isStream ? '（流式）' : ''}`);
            const response = await fetchWithRetry(targetUrl, headers, {
                attempts: isStream ? 3 : 2,
                timeoutMs: isStream ? 25000 : 12000,
                cf: cfOpts,
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => '');
                logDebug(`请求失败: ${response.status} ${response.statusText} - ${targetUrl}`);
                throw new Error(`HTTP error ${response.status}: ${response.statusText}. URL: ${targetUrl}. Body: ${errorBody.substring(0, 150)}`);
            }

            if (isStream && response.body) {
                const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
                logDebug(`流式透传: ${targetUrl} (${contentType})`);
                return { stream: response.body, contentType, isBinary: true, responseHeaders: response.headers, status: response.status };
            }

            // 读取响应内容：图片/音视频等二进制内容必须按字节透传，
            // 用 text() 读取会按 UTF-8 解码并替换非法字节，导致封面等文件损坏。
            const contentType = response.headers.get('Content-Type') || '';
            const isBinary = /^(image|audio|video)\//i.test(contentType)
                || /application\/octet-stream/i.test(contentType);
            const content = isBinary ? await response.arrayBuffer() : await response.text();
            logDebug(`请求成功: ${targetUrl}, Content-Type: ${contentType}${isBinary ? '（二进制透传）' : ''}`);
            return { content, contentType, isBinary, responseHeaders: response.headers }; // 同时返回原始响应头

        } catch (error) {
             logDebug(`请求彻底失败: ${targetUrl}: ${error.message}`);
            // 抛出更详细的错误
            throw new Error(`请求目标URL失败 ${targetUrl}: ${error.message}`);
        }
    }

    // 判断是否是 M3U8 内容
    function isM3u8Content(content, contentType) {
        // 检查 Content-Type
        if (contentType && (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl') || contentType.includes('audio/mpegurl'))) {
            return true;
        }
        // 检查内容本身是否以 #EXTM3U 开头
        return content && typeof content === 'string' && content.trim().startsWith('#EXTM3U');
    }

    // 判断是否是媒体文件 (根据扩展名和 Content-Type) - 这部分在此代理中似乎未使用，但保留
    function isMediaFile(url, contentType) {
        if (contentType) {
            for (const mediaType of MEDIA_CONTENT_TYPES) {
                if (contentType.toLowerCase().startsWith(mediaType)) {
                    return true;
                }
            }
        }
        const urlLower = url.toLowerCase();
        for (const ext of MEDIA_FILE_EXTENSIONS) {
            if (urlLower.endsWith(ext) || urlLower.includes(`${ext}?`)) {
                return true;
            }
        }
        return false;
    }

    // 处理 M3U8 中的 #EXT-X-KEY 行 (加密密钥)
    function processKeyLine(line, baseUrl) {
        return line.replace(/URI="([^"]+)"/, (match, uri) => {
            const absoluteUri = resolveUrl(baseUrl, uri);
            logDebug(`处理 KEY URI: 原始='${uri}', 绝对='${absoluteUri}'`);
            return `URI="${rewriteUrlToProxy(absoluteUri)}"`; // 重写为代理路径
        });
    }

    // 处理 M3U8 中的 #EXT-X-MAP 行 (初始化片段)
    function processMapLine(line, baseUrl) {
         return line.replace(/URI="([^"]+)"/, (match, uri) => {
             const absoluteUri = resolveUrl(baseUrl, uri);
             logDebug(`处理 MAP URI: 原始='${uri}', 绝对='${absoluteUri}'`);
             return `URI="${rewriteUrlToProxy(absoluteUri)}"`; // 重写为代理路径
         });
     }

    // 处理媒体 M3U8 播放列表 (包含视频/音频片段)
    // 顺带做「切片广告」过滤：只删两类高置信广告分片，避免误伤正片
    //   ① URI 里出现 ad / ads / adv / guanggao / gg / promo / sponsor 之类的独立段
    //   ② 时长明显异常（> max(15s, 3×中位时长)）且前后都是 DISCONTINUITY 的孤立长片段
    // 放在代理层做，是因为 iPad 走原生 HLS，前端的 hls.js loader 根本不会执行。
    function processMediaPlaylist(url, content) {
        const baseUrl = getBaseUrl(url);
        const rawLines = content.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; });

        // ① 解析成条目（把 EXTINF 和它后面的 URI 绑在一起，才能整段删除）
        const items = [];
        let pendingInf = null;
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            if (line.startsWith('#EXTINF')) { pendingInf = line; continue; }
            if (line.startsWith('#EXT-X-DISCONTINUITY')) { items.push({ kind: 'disc' }); continue; }
            if (line.startsWith('#')) { items.push({ kind: 'tag', text: line }); continue; }
            const dur = pendingInf ? parseFloat(pendingInf.slice(8)) : null;
            items.push({ kind: 'seg', inf: pendingInf, dur: isNaN(dur) ? null : dur, uri: line });
            pendingInf = null;
        }

        // ② 中位时长，用于判定「异常长片段」
        const durs = items.filter(function (it) { return it.kind === 'seg' && it.dur; })
            .map(function (it) { return it.dur; }).sort(function (a, b) { return a - b; });
        const median = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
        const adDurThreshold = Math.max(15, median * 3);

        const AD_URI_RE = /(^|[\/_.\-])(ad|ads|adv|advert|adver|guanggao|gg|promo|sponsor)([\/_.\-]|$)/i;
        const isAd = items.map(function (it, idx) {
            if (it.kind !== 'seg') return false;
            if (AD_URI_RE.test(it.uri)) return true;
            if (it.dur && it.dur > adDurThreshold) {
                const prev = items[idx - 1];
                const next = items[idx + 1];
                const prevBoundary = !prev || prev.kind === 'disc';
                const nextBoundary = !next || next.kind === 'disc';
                if (prevBoundary && nextBoundary) return true;
            }
            return false;
        });

        // ③ 输出（同时重写 KEY / MAP / 分片地址）
        const output = [];
        let removed = 0;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === 'disc') { output.push('#EXT-X-DISCONTINUITY'); continue; }
            if (it.kind === 'tag') {
                let t = it.text;
                if (t.startsWith('#EXT-X-KEY') || t.startsWith('#EXT-X-MAP')) {
                    if (RAW_MODE) {
                        // 只把相对地址绝对化，保留原始 CDN 地址
                        t = t.replace(/URI="([^"]+)"/, function (m, uri) {
                            return 'URI="' + resolveUrl(baseUrl, uri) + '"';
                        });
                    } else if (t.startsWith('#EXT-X-KEY')) {
                        t = processKeyLine(t, baseUrl);
                    } else {
                        t = processMapLine(t, baseUrl);
                    }
                }
                output.push(t);
                continue;
            }
            if (isAd[i]) { removed++; continue; }
            if (it.inf) output.push(it.inf);
            const absoluteUrl = resolveUrl(baseUrl, it.uri);
            output.push(RAW_MODE ? absoluteUrl : rewriteUrlToProxy(absoluteUrl));
        }

        // ④ 清理删广告后留下的孤立/重复 DISCONTINUITY（首尾和连续出现的都去掉）
        const cleaned = [];
        for (let i = 0; i < output.length; i++) {
            const line = output[i];
            if (line === '#EXT-X-DISCONTINUITY') {
                const prev = cleaned[cleaned.length - 1];
                if (!prev || prev === '#EXT-X-DISCONTINUITY' || prev.startsWith('#EXTM3U')) continue;
                if (i === output.length - 1) continue;
            }
            cleaned.push(line);
        }

        if (removed > 0) logDebug(`切片广告过滤：删除 ${removed} 个分片 (${url})`);
        return cleaned.join('\n');
    }

    // 递归处理 M3U8 内容
     async function processM3u8Content(targetUrl, content, recursionDepth = 0, env) {
         if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:')) {
             logDebug(`检测到主播放列表: ${targetUrl}`);
             return await processMasterPlaylist(targetUrl, content, recursionDepth, env);
         }
         logDebug(`检测到媒体播放列表: ${targetUrl}`);
         return processMediaPlaylist(targetUrl, content);
     }

    // 处理主 M3U8 播放列表
    async function processMasterPlaylist(url, content, recursionDepth, env) {
        if (recursionDepth > MAX_RECURSION) {
            throw new Error(`处理主列表时递归层数过多 (${MAX_RECURSION}): ${url}`);
        }

        const baseUrl = getBaseUrl(url);
        const lines = content.split('\n');
        const variants = [];

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

                 let variantUriLine = '';
                 for (let j = i + 1; j < lines.length; j++) {
                     const line = lines[j].trim();
                     if (line && !line.startsWith('#')) {
                         variantUriLine = line;
                         i = j;
                         break;
                     }
                 }

                 if (variantUriLine) {
                     variants.push({ bw: currentBandwidth, url: resolveUrl(baseUrl, variantUriLine) });
                 }
            }
        }

        // ⚠️ 不要锁最高码率：代理把 master 展开成单个 media playlist 后，
        // 客户端就失去了 ABR 能力。实测锁最高码率在弱网下必卡。
        // 取带宽中位数（既不清也不至于打满带宽）。
        let bestVariantUrl = '';
        if (variants.length) {
            variants.sort(function (a, b) { return a.bw - b.bw; });
            const pick = variants[Math.floor((variants.length - 1) / 2)];
            bestVariantUrl = pick.url;
        }

         if (!bestVariantUrl) {
             logDebug(`主列表中未找到 BANDWIDTH 或 STREAM-INF，尝试查找第一个子列表引用: ${url}`);
             for (let i = 0; i < lines.length; i++) {
                 const line = lines[i].trim();
                 if (line && !line.startsWith('#') && (line.endsWith('.m3u8') || line.includes('.m3u8?'))) { // 修复：检查是否包含 .m3u8?
                    bestVariantUrl = resolveUrl(baseUrl, line);
                     logDebug(`备选方案：找到第一个子列表引用: ${bestVariantUrl}`);
                     break;
                 }
             }
         }

        if (!bestVariantUrl) {
            logDebug(`在主列表 ${url} 中未找到任何有效的子播放列表 URL。可能格式有问题或仅包含音频/字幕。将尝试按媒体列表处理原始内容。`);
            return processMediaPlaylist(url, content);
        }

        // --- 获取并处理选中的子 M3U8 ---

        const cacheKey = `m3u8_processed:${bestVariantUrl}`; // 使用处理后的缓存键

        let kvNamespace = null;
        try {
            kvNamespace = env.LIBRETV_PROXY_KV; // 从环境获取 KV 命名空间 (变量名在 Cloudflare 设置)
            if (!kvNamespace) throw new Error("KV 命名空间未绑定");
        } catch (e) {
            logDebug(`KV 命名空间 'LIBRETV_PROXY_KV' 访问出错或未绑定: ${e.message}`);
            kvNamespace = null; // 确保设为 null
        }

        if (kvNamespace) {
            try {
                const cachedContent = await kvNamespace.get(cacheKey);
                if (cachedContent) {
                    logDebug(`[缓存命中] 主列表的子列表: ${bestVariantUrl}`);
                    return cachedContent;
                } else {
                    logDebug(`[缓存未命中] 主列表的子列表: ${bestVariantUrl}`);
                }
            } catch (kvError) {
                logDebug(`从 KV 读取缓存失败 (${cacheKey}): ${kvError.message}`);
                // 出错则继续执行，不影响功能
            }
        }

        logDebug(`选择的子列表 (带宽: ${highestBandwidth}): ${bestVariantUrl}`);
        const { content: variantContent, contentType: variantContentType } = await fetchContentWithType(bestVariantUrl);

        if (!isM3u8Content(variantContent, variantContentType)) {
            logDebug(`获取到的子列表 ${bestVariantUrl} 不是 M3U8 内容 (类型: ${variantContentType})。可能直接是媒体文件，返回原始内容。`);
             // 如果不是M3U8，但看起来像媒体内容，直接返回代理后的内容
             // 注意：这里可能需要决定是否直接代理这个非 M3U8 的 URL
             // 为了简化，我们假设如果不是 M3U8，则流程中断或按原样处理
             // 或者，尝试将其作为媒体列表处理？（当前行为）
             // return createResponse(variantContent, 200, { 'Content-Type': variantContentType || 'application/octet-stream' });
             // 尝试按媒体列表处理，以防万一
             return processMediaPlaylist(bestVariantUrl, variantContent);

        }

        const processedVariant = await processM3u8Content(bestVariantUrl, variantContent, recursionDepth + 1, env);

        if (kvNamespace) {
             try {
                 // 使用 waitUntil 异步写入缓存，不阻塞响应返回
                 // 注意 KV 的写入限制 (免费版每天 1000 次)
                 waitUntil(kvNamespace.put(cacheKey, processedVariant, { expirationTtl: CACHE_TTL }));
                 logDebug(`已将处理后的子列表写入缓存: ${bestVariantUrl}`);
             } catch (kvError) {
                 logDebug(`向 KV 写入缓存失败 (${cacheKey}): ${kvError.message}`);
                 // 写入失败不影响返回结果
             }
        }

        return processedVariant;
    }

    // --- 主要请求处理逻辑 ---

    try {
        const targetUrl = getTargetUrlFromPath(url.pathname);

        if (!targetUrl) {
            logDebug(`无效的代理请求路径: ${url.pathname}`);
            return createResponse("无效的代理请求。路径应为 /proxy/<经过编码的URL>", 400);
        }

        logDebug(`收到代理请求: ${targetUrl}`);

        // --- 边缘缓存（Cache API）---
        // 采集站的 JSON 接口（搜索/分类/详情）是纯读、同一关键词会被反复请求
        // （首页「最新」、翻页、切分类、多人重复搜同一部片）。
        // 放在边缘缓存 60 秒，重复请求不再回源；视频分片与 m3u8 不缓存。
        const isJsonApi = /[?&]ac=(videolist|class|detail|list)(&|=|$)/i.test(targetUrl);
        const edgeCacheable = isJsonApi && request.method === 'GET';
        let edgeCacheKey = null;
        if (edgeCacheable) {
            edgeCacheKey = new Request('https://edge-cache.invalid/' + encodeURIComponent(targetUrl));
            try {
                const hit = await caches.default.match(edgeCacheKey);
                if (hit) {
                    const body = await hit.text();
                    logDebug(`边缘缓存命中: ${targetUrl}`);
                    return createResponse(body, 200, {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'public, max-age=60',
                        'X-Edge-Cache': 'HIT'
                    });
                }
            } catch (cacheErr) {
                logDebug(`边缘缓存读取失败: ${cacheErr.message}`);
            }
        }

        // --- 缓存检查 (KV) ---
        const cacheKey = `proxy_raw:${targetUrl}`; // 使用原始内容的缓存键
        let kvNamespace = null;
        try {
            kvNamespace = env.LIBRETV_PROXY_KV;
            if (!kvNamespace) throw new Error("KV 命名空间未绑定");
        } catch (e) {
            logDebug(`KV 命名空间 'LIBRETV_PROXY_KV' 访问出错或未绑定: ${e.message}`);
            kvNamespace = null;
        }

        if (kvNamespace) {
            try {
                const cachedDataJson = await kvNamespace.get(cacheKey); // 直接获取字符串
                if (cachedDataJson) {
                    logDebug(`[缓存命中] 原始内容: ${targetUrl}`);
                    const cachedData = JSON.parse(cachedDataJson); // 解析 JSON
                    const content = cachedData.body;
                    let headers = {};
                    try { headers = JSON.parse(cachedData.headers); } catch(e){} // 解析头部
                    const contentType = headers['content-type'] || headers['Content-Type'] || '';

                    if (isM3u8Content(content, contentType)) {
                        logDebug(`缓存内容是 M3U8，重新处理: ${targetUrl}`);
                        const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
                        return createM3u8Response(processedM3u8, isLivePlaylist(content));
                    } else {
                        logDebug(`从缓存返回非 M3U8 内容: ${targetUrl}`);
                        return createResponse(content, 200, new Headers(headers));
                    }
                } else {
                     logDebug(`[缓存未命中] 原始内容: ${targetUrl}`);
                 }
            } catch (kvError) {
                 logDebug(`从 KV 读取或解析缓存失败 (${cacheKey}): ${kvError.message}`);
                 // 出错则继续执行，不影响功能
            }
        }

        // --- 实际请求 ---
        const { content, contentType, isBinary, responseHeaders, stream, status: upstreamStatus } = await fetchContentWithType(targetUrl);

        // --- 流式透传：分片/密钥直接边下边发，首字节不用等整片 ---
        if (stream) {
            const sh = new Headers();
            for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
                const v = responseHeaders.get(k);
                if (v) sh.set(k, v);
            }
            if (!sh.has('content-type')) sh.set('content-type', contentType || 'application/octet-stream');
            sh.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
            sh.set('Access-Control-Allow-Origin', '*');
            sh.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
            sh.set('Access-Control-Allow-Headers', '*');
            sh.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
            return new Response(stream, { status: upstreamStatus || 200, headers: sh });
        }

        // --- 写入缓存 (KV) ---
        // 二进制内容（图片等）不写入 KV：一是 JSON 序列化会破坏字节，二是体积大且无必要
        const liveList = isM3u8Content(content, contentType) && isLivePlaylist(content);
        if (kvNamespace && !isBinary && !liveList) {
             try {
                 const headersToCache = {};
                 responseHeaders.forEach((value, key) => { headersToCache[key.toLowerCase()] = value; });
                 const cacheValue = { body: content, headers: JSON.stringify(headersToCache) };
                 // 注意 KV 写入限制
                 waitUntil(kvNamespace.put(cacheKey, JSON.stringify(cacheValue), { expirationTtl: CACHE_TTL }));
                 logDebug(`已将原始内容写入缓存: ${targetUrl}`);
            } catch (kvError) {
                 logDebug(`向 KV 写入缓存失败 (${cacheKey}): ${kvError.message}`);
                 // 写入失败不影响返回结果
            }
        }

        // --- 处理响应 ---
        if (isM3u8Content(content, contentType)) {
            logDebug(`内容是 M3U8，开始处理: ${targetUrl}`);
            const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
            return createM3u8Response(processedM3u8, isLivePlaylist(content));
        } else {
            logDebug(`内容不是 M3U8 (类型: ${contentType})，直接返回: ${targetUrl}`);
            const finalHeaders = new Headers(responseHeaders);
            // ⚠️ 采集站返回 JSON 但 Content-Type 常常是 text/html，
            // 不能只按 Content-Type 判断，要结合目标 URL 的 ac= 参数。
            const isJsonResp = /json/i.test(contentType || '') || (isJsonApi && !isBinary);
            finalHeaders.set('Cache-Control', isJsonResp ? 'public, max-age=60' : `public, max-age=${CACHE_TTL}`);
            // 添加 CORS 头，确保非 M3U8 内容也能跨域访问（例如图片、字幕文件等）
            finalHeaders.set("Access-Control-Allow-Origin", "*");
            finalHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
            finalHeaders.set("Access-Control-Allow-Headers", "*");
            const finalResponse = createResponse(content, 200, finalHeaders);

            // 写回边缘缓存（只缓存 JSON 文本，不缓存二进制）
            if (edgeCacheKey && isJsonResp && !isBinary) {
                try {
                    waitUntil(caches.default.put(edgeCacheKey, new Response(content, {
                        headers: {
                            'Content-Type': 'application/json; charset=utf-8',
                            'Cache-Control': 'public, max-age=60'
                        }
                    })));
                    logDebug(`已写入边缘缓存: ${targetUrl}`);
                } catch (cacheErr) {
                    logDebug(`边缘缓存写入失败: ${cacheErr.message}`);
                }
            }
            return finalResponse;
        }

    } catch (error) {
        logDebug(`处理代理请求时发生严重错误: ${error.message} \n ${error.stack}`);
        return createResponse(`代理处理错误: ${error.message}`, 500);
    }
}

// 处理 OPTIONS 预检请求的函数
export async function onOptions(context) {
    // 直接返回允许跨域的头信息
    return new Response(null, {
        status: 204, // No Content
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*", // 允许所有请求头
            "Access-Control-Max-Age": "86400", // 预检请求结果缓存一天
        },
    });
}
