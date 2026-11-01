const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]');
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 改进返回功能
function goBack(event) {
    // 防止默认链接行为
    if (event) event.preventDefault();
    
    // 1. 优先检查URL参数中的returnUrl
    const urlParams = new URLSearchParams(window.location.search);
    const returnUrl = urlParams.get('returnUrl');
    
    if (returnUrl) {
        // 如果URL中有returnUrl参数，优先使用
        window.location.href = decodeURIComponent(returnUrl);
        return;
    }
    
    // 2. 检查localStorage中保存的lastPageUrl
    const lastPageUrl = localStorage.getItem('lastPageUrl');
    if (lastPageUrl && lastPageUrl !== window.location.href) {
        window.location.href = lastPageUrl;
        return;
    }
    
    // 3. 检查是否是从搜索页面进入的播放器
    const referrer = document.referrer;
    
    // 检查 referrer 是否包含搜索参数
    if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        // 如果是从搜索页面来的，返回到搜索页面
        window.location.href = referrer;
        return;
    }
    
    // 4. 如果是在iframe中打开的，尝试关闭iframe
    if (window.self !== window.top) {
        try {
            // 尝试调用父窗口的关闭播放器函数
            window.parent.closeVideoPlayer && window.parent.closeVideoPlayer();
            return;
        } catch (e) {
            console.error('调用父窗口closeVideoPlayer失败:', e);
        }
    }
    
    // 5. 无法确定上一页，则返回首页
    if (!referrer || referrer === '') {
        window.location.href = '/';
        return;
    }
    
    // 6. 以上都不满足，使用默认行为：返回上一页
    window.history.back();
}

// 页面加载时保存当前URL到localStorage，作为返回目标
window.addEventListener('load', function () {
    // 保存前一页面URL
    if (document.referrer && document.referrer !== window.location.href) {
        localStorage.setItem('lastPageUrl', document.referrer);
    }

    // 提取当前URL中的重要参数，以便在需要时能够恢复当前页面
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    const sourceCode = urlParams.get('source');

    if (videoId && sourceCode) {
        // 保存当前播放状态，以便其他页面可以返回
        localStorage.setItem('currentPlayingId', videoId);
        localStorage.setItem('currentPlayingSource', sourceCode);
    }
});


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let art = null; // 用于 ArtPlayer 实例
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
Artplayer.FULLSCREEN_WEB_IN_BODY = true;

// 页面加载
document.addEventListener('DOMContentLoaded', function () {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('player-loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('player-loading').style.display = 'block';

    initializePageContent();
});

// 初始化页面内容
function initializePageContent() {

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    let videoUrl = urlParams.get('url');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 从URL获取集数信息
    const savedPosition = parseInt(urlParams.get('position') || '0'); // 获取保存的播放位置
    // 解决历史记录问题：检查URL是否是player.html开头的链接
    // 如果是，说明这是历史记录重定向，需要解析真实的视频URL
    if (videoUrl && videoUrl.includes('player.html')) {
        try {
            // 尝试从嵌套URL中提取真实的视频链接
            const nestedUrlParams = new URLSearchParams(videoUrl.split('?')[1]);
            // 从嵌套参数中获取真实视频URL
            const nestedVideoUrl = nestedUrlParams.get('url');
            // 检查嵌套URL是否包含播放位置信息
            const nestedPosition = nestedUrlParams.get('position');
            const nestedIndex = nestedUrlParams.get('index');
            const nestedTitle = nestedUrlParams.get('title');

            if (nestedVideoUrl) {
                videoUrl = nestedVideoUrl;

                // 更新当前URL参数
                const url = new URL(window.location.href);
                if (!urlParams.has('position') && nestedPosition) {
                    url.searchParams.set('position', nestedPosition);
                }
                if (!urlParams.has('index') && nestedIndex) {
                    url.searchParams.set('index', nestedIndex);
                }
                if (!urlParams.has('title') && nestedTitle) {
                    url.searchParams.set('title', nestedTitle);
                }
                // 替换当前URL
                window.history.replaceState({}, '', url);
            } else {
                showError('历史记录链接无效，请返回首页重新访问');
            }
        } catch (e) {
        }
    }

    // 保存当前视频URL
    currentVideoUrl = videoUrl || '';

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true

    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function (e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });

    // 优先使用URL传递的集数信息，否则从localStorage获取
    try {
        if (episodesList) {
            // 如果URL中有集数数据，优先使用它
            currentEpisodes = JSON.parse(decodeURIComponent(episodesList));

        } else {
            // 否则从localStorage获取
            currentEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');

        }

        // 检查集数索引是否有效，如果无效则调整为0
        if (index < 0 || (currentEpisodes.length > 0 && index >= currentEpisodes.length)) {
            // 如果索引太大，则使用最大有效索引
            if (index >= currentEpisodes.length && currentEpisodes.length > 0) {
                index = currentEpisodes.length - 1;
            } else {
                index = 0;
            }

            // 更新URL以反映修正后的索引
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('index', index);
            window.history.replaceState({}, '', newUrl);
        }

        // 更新当前索引为验证过的值
        currentEpisodeIndex = index;

        episodesReversed = localStorage.getItem('episodesReversed') === 'true';
    } catch (e) {
        currentEpisodes = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl);
    } else {
        showError('无效的视频链接');
    }

    // 渲染源信息
    renderResourceInfoBar();

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // 更新排序按钮状态
    updateOrderButton();

    // 添加对进度条的监听，确保点击准确跳转
    setTimeout(() => {
        setupProgressBarPreciseClicks();
    }, 1000);

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 视频暂停时也保存
    const waitForVideo = setInterval(() => {
        if (art && art.video) {
            art.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            art.video.addEventListener('timeupdate', function() {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);
}

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
        if (art && art.currentTime > 5) {
            art.currentTime -= 5;
            showShortcutHint('快退', 'left');
            e.preventDefault();
        }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
        if (art && art.currentTime < art.duration - 5) {
            art.currentTime += 5;
            showShortcutHint('快进', 'right');
            e.preventDefault();
        }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
        if (art && art.volume < 1) {
            art.volume += 0.1;
            showShortcutHint('音量+', 'up');
            e.preventDefault();
        }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
        if (art && art.volume > 0) {
            art.volume -= 0.1;
            showShortcutHint('音量-', 'down');
            e.preventDefault();
        }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
        if (art) {
            art.toggle();
            showShortcutHint('播放/暂停', 'play');
            e.preventDefault();
        }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
        if (art) {
            art.fullscreen = !art.fullscreen;
            showShortcutHint('切换全屏', 'fullscreen');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else if (direction === 'right') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }  else if (direction === 'up') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>';
    } else if (direction === 'down') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>';
    } else if (direction === 'fullscreen') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>';
    } else if (direction === 'play') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 初始化播放器
// 判断播放列表里是否有「切片广告」特征（与代理端 rules 保持一致）
function analyzePlaylistForAds(text) {
    const lines = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    const segs = [];
    let dur = null;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.indexOf('#EXTINF:') === 0) { dur = parseFloat(l.slice(8)); continue; }
        if (l.charAt(0) === '#') {
            if (l === '#EXT-X-DISCONTINUITY') segs.push({ disc: true });
            continue;
        }
        if (dur !== null) { segs.push({ dur: dur, uri: l }); dur = null; }
    }
    const AD_URI_RE = /(^|[\/_.\-])(ad|ads|adv|advert|guanggao|gg|promo|sponsor)([\/_.\-]|$)/i;
    for (let i = 0; i < segs.length; i++) {
        const it = segs[i];
        if (it.disc) continue;
        if (AD_URI_RE.test(it.uri)) return true;
    }
    const durs = segs.filter(function (x) { return x.dur; }).map(function (x) { return x.dur; }).sort(function (a, b) { return a - b; });
    const median = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
    const threshold = Math.max(15, median * 3);
    for (let i = 0; i < segs.length; i++) {
        const it = segs[i];
        if (it.disc || !it.dur || it.dur <= threshold) continue;
        const prev = segs[i - 1];
        const next = segs[i + 1];
        const prevBoundary = !prev || prev.disc;
        const nextBoundary = !next || next.disc;
        if (prevBoundary && nextBoundary) return true;
    }
    return false;
}

// 带 6 秒超时的文本拉取（不用 AbortSignal.timeout，Safari 13.1 没有）
function fetchPlaylistText(url) {
    return new Promise(function (resolve, reject) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 6000);
        fetch(url, { signal: controller.signal }).then(function (r) {
            clearTimeout(timer);
            if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
            r.text().then(resolve, reject);
        }).catch(function (e) { clearTimeout(timer); reject(e); });
    });
}

// 预取首个分片：起播时播放器还要再等一个 RTT 才拿到第一片，
// 提前 fetch 一次能命中浏览器缓存并预热 CDN 连接
function prefetchFirstSegment(text, baseUrl) {
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l || l.charAt(0) === '#') continue;
        if (/\.(ts|m4s|mp4|aac|m4a)(\?|$)/i.test(l)) {
            try {
                var u = new URL(l, baseUrl).toString();
                fetch(u, { cache: 'force-cache' }).catch(function () {});
            } catch (e) { /* 忽略 */ }
            return;
        }
    }
}

// 从 master playlist 里挑一个变体（取最高带宽）
function pickVariantUrl(text, baseUrl) {
    var lines = String(text).split('\n');
    var best = null, bestBw = -1;
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l.indexOf('#EXT-X-STREAM-INF') === 0) {
            var m = l.match(/BANDWIDTH=(\d+)/);
            var bw = m ? parseInt(m[1], 10) : 0;
            for (var j = i + 1; j < lines.length; j++) {
                var u = lines[j].trim();
                if (u && u.charAt(0) !== '#') {
                    if (bw >= bestBw) { bestBw = bw; best = u; }
                    break;
                }
            }
        }
    }
    if (!best) return null;
    try { return new URL(best, baseUrl).toString(); } catch (e) { return null; }
}

// 只有真的含广告分片才走代理过滤；否则直接用原地址（无广告的源零额外延迟）
async function buildAdFilteredUrl(url) {
    if (typeof adFilteringEnabled !== 'undefined' && !adFilteringEnabled) return url;
    if (!/^https?:\/\//i.test(url)) return url;
    if (url.indexOf('/proxy/') === 0) return url;
    try {
        var text = await fetchPlaylistText(url);
        if (/#EXT-X-STREAM-INF/.test(text)) {
            var variant = pickVariantUrl(text, url);
            if (!variant) return url;
            text = await fetchPlaylistText(variant);
        }
        if (!analyzePlaylistForAds(text)) {
            prefetchFirstSegment(text, url);
            return url;
        }
        return PROXY_URL + encodeURIComponent(url) + '?raw=1';
    } catch (e) {
        return url; // 探测失败就用原地址，不影响播放
    }
}

// ===== 播放器 HUD：当前源 + 实时速度（MB/s）=====
// 速度用"滚动 5 秒窗口"统计真实字节数，而不是每秒取一次瞬时值——
// HLS 是分片下载：一片几秒下完，然后可能空闲，瞬时值会长期显示 0.00。
// 同时记录最近一个分片自身的下载速率，作为"当前这一片有多快"的即时读数。
let netHudEl = null;
let netHudSamples = [];      // {t, bytes} 最近 5 秒的字节采样
let netHudSpeed = 0;
let netHudTimer = null;
let netHudObserved = false;
let netHudBitrate = 0;       // 字节/秒，原生播放时用缓冲增长估算
let netHudLastBufEnd = 0;
let netHudWatching = false;
let netHudDim = false;
let netHudCalibrating = false;
let netHudZeroTicks = 0;
let netHudProbeUrl = '';
let netHudProbing = false;
let netHudLastProbe = 0;
let netHudLastGood = 0;
let netHudCalibAt = 0;
let netHudStuck = 0;      // 最近一次测到的非零速度，缓冲满时显示它
let netHudFragSpeed = 0;     // 最近一个分片的下载速率（MB/s）
let netHudFragAt = 0;
const NET_HUD_WINDOW_MS = 5000;
const NET_HUD_DEBUG = /[?&]huddebug=1/.test(location.search);

function netHudSourceName() {
    try {
        const key = new URLSearchParams(window.location.search).get('source') || '';
        if (key && typeof API_SITES !== 'undefined' && API_SITES[key]) {
            return API_SITES[key].name || key;
        }
        return key || '未知源';
    } catch (e) {
        return '未知源';
    }
}

function ensureNetHud() {
    if (netHudEl && document.body.contains(netHudEl)) return netHudEl;
    const host = document.querySelector('#player .art-video-player') ||
        document.getElementById('player') ||
        document.body;
    try {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch (e) {}
    const el = document.createElement('div');
    el.id = 'net-hud';
    el.style.cssText = [
        'position:absolute', 'right:14px', 'top:14px', 'z-index:60',
        'padding:8px 14px', 'border-radius:13px',
        'background:rgba(0,0,0,.55)', 'color:#e8eaed',
        'font:18px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        'pointer-events:none', 'white-space:nowrap',
        'text-shadow:0 1px 2px rgba(0,0,0,.6)'
    ].join(';');
    el.innerHTML = '<div id="net-hud-src" style="opacity:.85"></div>' +
        '<div><span id="net-hud-spd" style="color:#4ade80;font-weight:600">0.00</span>' +
        '<span style="opacity:.7"> MB/s</span>' +
        '<span id="net-hud-note" style="opacity:.55;font-size:12.5px;margin-left:6px"></span></div>' +
        (NET_HUD_DEBUG ? '<div id="net-hud-dbg" style="opacity:.6;font-size:10.5px"></div>' : '');
    host.appendChild(el);
    netHudEl = el;
    return el;
}

function netHudAddBytes(n) {
    if (n > 0) netHudSamples.push({ t: performance.now(), bytes: n });
}

// 分片自身的下载速率：这一片下了多久、下了多少字节
function netHudRecordFrag(stats) {
    try {
        if (!stats || !stats.loading) return;
        const secs = (stats.loading.end - stats.loading.start) / 1000;
        const bytes = stats.loaded || 0;
        if (secs > 0.05 && bytes > 0) {
            netHudFragSpeed = (bytes / 1048576) / secs;
            netHudFragAt = performance.now();
        }
    } catch (e) {}
}

// 播放器每次 initPlayer 都会 art.destroy() + new Artplayer()，
// .art-video-player 是全新元素：把 observer 绑在它上面，切集后就再也收不到
// art-control-show 的变化，HUD 会一直亮着。所以 observer 必须绑在稳定的
// #player 容器上（subtree），每次回调都重新查当前的播放器元素。
let netHudObsTarget = null;
let netHudHidden = false;

function netHudPlayerEl() {
    return document.querySelector('#player .art-video-player') ||
        document.querySelector('.art-video-player');
}

function netHudSyncVisibility() {
    if (!netHudEl) return;
    const p = netHudPlayerEl();
    // 进度条在 art-control-show（控制栏展开）或 art-hover（鼠标悬停）时可见
    const show = p ? (p.classList.contains('art-control-show') || p.classList.contains('art-hover')) : true;
    netHudHidden = !show;
    netHudEl.style.transition = 'opacity .18s ease';
    netHudEl.style.opacity = show ? (netHudDim ? '.75' : '1') : '0';
}

function netHudBindVisibility() {
    const target = document.getElementById('player') || document.body;
    if (netHudObsTarget === target) {
        netHudSyncVisibility();
        return;
    }
    netHudObsTarget = target;
    try {
        new MutationObserver(netHudSyncVisibility).observe(target, {
            attributes: true, attributeFilter: ['class'], subtree: true, childList: true
        });
    } catch (e) {}
    netHudSyncVisibility();
}

function netHudStart() {
    ensureNetHud();
    const srcEl = document.getElementById('net-hud-src');
    if (srcEl) srcEl.textContent = '源 · ' + netHudSourceName();

    netHudBindVisibility();

    if (netHudTimer) return;

    netHudTimer = setInterval(function () {
        const now = performance.now();
        const v = (typeof art !== 'undefined' && art) ? art.video : null;

        // 原生播放（Safari/iOS）没有分片事件：用缓冲增长 × 码率补字节
        let bufEnd = 0;
        if (v && v.buffered && v.buffered.length) {
            for (let i = 0; i < v.buffered.length; i++) {
                if (v.currentTime >= v.buffered.start(i) - 1 && v.currentTime <= v.buffered.end(i) + 1) {
                    bufEnd = v.buffered.end(i);
                    break;
                }
            }
        }
        if (netHudBitrate > 0 && bufEnd > 0) {
            const growth = Math.max(0, bufEnd - netHudLastBufEnd);
            if (growth > 0) netHudAddBytes(growth * netHudBitrate);
        }
        if (bufEnd > 0) netHudLastBufEnd = bufEnd;

        // 滚动窗口统计
        netHudSamples = netHudSamples.filter(function (s) { return now - s.t <= NET_HUD_WINDOW_MS; });
        const total = netHudSamples.reduce(function (a, s) { return a + s.bytes; }, 0);
        let span = 5;
        if (netHudSamples.length) {
            span = Math.min(5, Math.max(1, (now - netHudSamples[0].t) / 1000));
        }
        let speed = total / span / 1048576;

        // 刚下完一片时，用这一片自身的速率，读数更"即时"
        if (now - netHudFragAt < 6000 && netHudFragSpeed > speed) speed = netHudFragSpeed;

        netHudSpeed = speed;

        const spdEl = document.getElementById('net-hud-spd');
        const noteEl = document.getElementById('net-hud-note');
        const paused = !v || v.paused;
        if (speed >= 0.005) netHudLastGood = speed;
        let shown = speed;
        let note = '';
        if (paused) {
            shown = 0;
            note = '已暂停';
        } else if (speed < 0.005) {
            shown = netHudLastGood;
            note = '缓冲已满';
        }
        if (spdEl) spdEl.textContent = shown.toFixed(2);
        // 长时间 0 且没在暂停：把关键状态直接写进 note，方便一眼定位
        if (!paused && shown < 0.005) {
            netHudStuck = (netHudStuck || 0) + 1;
            if (netHudStuck > 20) {
                note = '缓冲已满 · br=' + Math.round(netHudBitrate) + ' p=' + (netHudProbeUrl ? 1 : 0) +
                    ' n=' + netHudSamples.length;
            }
        } else {
            netHudStuck = 0;
        }
        if (noteEl) noteEl.textContent = note;
        netHudDim = (note === '缓冲已满');
        if (netHudEl) netHudEl.style.opacity = netHudHidden ? '0' : (netHudDim ? '.75' : '1');

        if (NET_HUD_DEBUG) {
            const dbg = document.getElementById('net-hud-dbg');
            if (dbg) dbg.textContent = 'br=' + Math.round(netHudBitrate) + ' frag=' + netHudFragSpeed.toFixed(2) +
                ' n=' + netHudSamples.length + ' t=' + Math.round(v ? v.currentTime : 0);
        }

        // 一直没有字节但视频在播 → 大概率是原生播放路径，去标定码率
        // 标定失败（比如当时还拿不到 duration）10 秒后重试一次
        if (!netHudBitrate && netHudCalibrating && netHudCalibAt && (now - netHudCalibAt > 10000)) {
            netHudCalibrating = false;
            netHudZeroTicks = 0;
        }
        if (!netHudBitrate && !netHudCalibrating && v && !v.paused && v.currentTime > 2) {
            netHudZeroTicks++;
            if (netHudZeroTicks >= 6) {
                netHudCalibrating = true;
                netHudCalibAt = now;
                const u = String(currentVideoUrl || '');
                if (/\.m3u8(\?|$)/i.test(u)) netHudCalibrate(u);
                else netHudCalibrateProgressive(u);
            }
        } else if (total > 0) {
            netHudZeroTicks = 0;
        }

        // 空闲（缓冲已满 / 原生播放拿不到字节）时，交给服务端实测这个源的真实速度。
        // 浏览器端在 iOS 上既没有分片事件、Range 又可能被忽略，只有服务端能稳定测出来。
        if (total === 0 && currentVideoUrl && v && !v.paused && !netHudProbing && (netHudLastProbe === 0 || now - netHudLastProbe > 20000)) {
            netHudLastProbe = now;
            netHudProbing = true;
            fetch('/api/probe?u=' + encodeURIComponent(currentVideoUrl), { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d && d.ok && d.mbps > 0) {
                        netHudFragSpeed = d.mbps;
                        netHudFragAt = performance.now();
                    }
                })
                .catch(function () {})
                .finally(function () { netHudProbing = false; });
        }
    }, 500);
}

// 标定码率：取播放列表第一条分片，读它的字节数和时长
async function netHudCalibrate(playlistUrl) {
    if (!playlistUrl || netHudBitrate > 0) return;
    try {
        let text = await (await fetch(PROXY_URL + encodeURIComponent(playlistUrl))).text();
        for (let depth = 0; depth < 2; depth++) {
            const lines = text.split('\n');
            const firstUri = lines.find(function (l) { return l.trim() && !l.trim().startsWith('#'); });
            if (!firstUri) return;
            if (/#EXT-X-STREAM-INF/i.test(text)) {
                const u = firstUri.trim();
                const next = u.startsWith('/proxy/') ? u : PROXY_URL + encodeURIComponent(new URL(u, playlistUrl).toString());
                text = await (await fetch(next)).text();
                continue;
            }
            let dur = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXTINF:')) dur = parseFloat(lines[i].slice(8)) || 0;
                const l = lines[i].trim();
                if (!l || l.startsWith('#')) continue;
                if (!dur) return;
                netHudProbeUrl = l;
                let size = 0;
                const r = await fetch(l, { headers: { Range: 'bytes=0-0' } });
                const cr = r.headers.get('content-range') || '';
                size = Number(cr.split('/')[1]) || Number(r.headers.get('content-length')) || 0;
                if (!size) {
                    const full = await fetch(l);
                    size = Number(full.headers.get('content-length')) || (await full.arrayBuffer()).byteLength;
                }
                if (size > 0) netHudBitrate = size / dur;
                return;
            }
            return;
        }
    } catch (e) {}
}

// 非 HLS（直链 mp4 等）：用 Range 读总大小，配 duration 直接算码率
async function netHudCalibrateProgressive(url) {
    if (!url || netHudBitrate > 0) return;
    try {
        const p = PROXY_URL + encodeURIComponent(url);
        netHudProbeUrl = p;
        const r = await fetch(p, { headers: { Range: 'bytes=0-0' } });
        const cr = r.headers.get('content-range') || '';
        const total = Number(cr.split('/')[1]) || Number(r.headers.get('content-length')) || 0;
        const dur = (art && art.video && art.video.duration) || 0;
        if (total > 0 && dur > 0) netHudBitrate = total / dur;
    } catch (e) {}
}

function initPlayer(videoUrl) {
    if (!videoUrl) {
        return
    }

    // 销毁旧实例
    if (art) {
        art.destroy();
        art = null;
    }

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        // 广告过滤已移到代理层，不再需要自定义 loader。
        // ⚠️ 不能写 loader: Hls.DefaultConfig.loader —— 这份 hls.min.js 构建没有导出
        // DefaultConfig（运行时是 undefined），会让 initPlayer 直接抛错、播放器卡在加载中。
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        // 点播场景把缓冲拉满：目标 120s / 上限 300s，扛得住 CDN 抖动
        maxBufferLength: 120,
        maxMaxBufferLength: 300,
        maxBufferSize: 120 * 1000 * 1000,
        maxBufferHole: 0.3,
        startFragPrefetch: true,
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 3000000,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.6,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 30000,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        appendErrorMaxRetry: 6,
        // hls.js 1.6 的加载策略：首字节超时放宽，分片允许更长总时长
        manifestLoadPolicy: {
            default: {
                maxTimeToFirstByteMs: 8000, maxLoadTimeMs: 20000,
                timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
                errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
            }
        },
        playlistLoadPolicy: {
            default: {
                maxTimeToFirstByteMs: 8000, maxLoadTimeMs: 20000,
                timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
                errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
            }
        },
        fragLoadPolicy: {
            default: {
                maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 120000,
                timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
                errorRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 8000 }
            }
        }
    };

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: 'm3u8',
        title: videoTitle,
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        // 关闭底部迷你进度条：控制栏自动隐藏后，播放器底部不再残留一条细进度线
        // （全屏时这条线横贯整屏底部，最显眼）
        miniProgressBar: false,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        hotkey: false,
        theme: '#23ade5',
        lang: navigator.language.toLowerCase(),
        moreVideoAttr: {
            crossOrigin: 'anonymous',
        },
        customType: {
            m3u8: function (video, url) {
                // 清理之前的HLS实例
                if (currentHls && currentHls.destroy) {
                    try {
                        currentHls.destroy();
                    } catch (e) {
                    }
                    currentHls = null;
                }

                // iOS 13.1（尤其 iPhone）的 Safari 不支持 MSE，hls.js 在该环境下
                // 完全无法工作；但 Safari 自带原生 HLS 能力，所以这里做原生回退：
                //   - iPhone / 旧款 iPad：Hls.isSupported() === false → 交由原生播放
                //   - 桌面 Chrome / Firefox / 新版 Safari：保持原有 hls.js 逻辑
                const nativeHlsType = video.canPlayType('application/vnd.apple.mpegurl');
                // Safari / iOS 优先走原生 HLS：Safari 的 MSE 不支持 MPEG-TS 分片，
                // hls.js 会先「支持」再在 append 阶段失败重试，表现为长时间黑屏/卡顿。
                // 原生播放器对 HLS 的缓冲与码率切换是系统级实现，最稳。
                const isSafariLike = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
                    || /iPad|iPhone|iPod/.test(navigator.userAgent);
                if ((isSafariLike || !Hls.isSupported()) && nativeHlsType) {
                    video.preload = 'auto';
                    video.setAttribute('playsinline', '');
                    video.setAttribute('webkit-playsinline', '');
                    // 先直连探测：只有真的含广告分片才走代理过滤，否则零额外延迟
                    let currentPlayUrl = url;
                    video.addEventListener('loadedmetadata', function () {
                        const loading = document.getElementById('player-loading');
                        if (loading) loading.style.display = 'none';
                        video.play().catch(function () {});
                    });
                    // 原生路径原本没有"播放成功就收起错误遮罩"的逻辑：
                    // 一旦旧源收尾时弹过一次错误，遮罩就会一直盖在正在播放的画面上。
                    video.addEventListener('playing', function () {
                        const eb = document.getElementById('error');
                        if (eb) {
                            eb.style.display = 'none';
                            eb.textContent = '';
                        }
                        window.isSwitchingVideo = false;
                    });
                    video.addEventListener('error', function () {
                        // 切集时旧源收尾会触发 error，但新一集往往已经开播；
                        // 只处理"确实没在播"的错误，避免遮罩盖住正常播放的画面。
                        if (window.isSwitchingVideo) return;
                        if (!video.error) return;
                        if (video.readyState >= 2) return;
                        if (currentPlayUrl !== url) {
                            currentPlayUrl = url;
                            video.src = url;
                            video.play().catch(function () {});
                            return;
                        }
                        // 再等 1.5s 确认：真的起不来才显示错误
                        setTimeout(function () {
                            if (window.isSwitchingVideo) return;
                            if (video.readyState >= 2 || !video.error) return;
                            const loading = document.getElementById('player-loading');
                            const errorBox = document.getElementById('error');
                            if (loading) loading.style.display = 'none';
                            if (errorBox) {
                                errorBox.style.display = 'block';
                                errorBox.textContent = '当前浏览器无法播放该视频源';
                            }
                        }, 1500);
                    });
                    buildAdFilteredUrl(url).then(function (playUrl) {
                        currentPlayUrl = playUrl;
                        video.src = playUrl;
                        video.play().catch(function () {});
                    }).catch(function () {
                        currentPlayUrl = url;
                        video.src = url;
                    });
                    return;
                }

                // 创建新的HLS实例
                const hls = new Hls(hlsConfig);
                currentHls = hls;
                window.__currentHls = hls; // 便于在控制台核对实际生效的配置

                // 跟踪是否已经显示错误
                let errorDisplayed = false;
                // 跟踪是否有错误发生
                let errorCount = 0;
                // 跟踪视频是否开始播放
                let playbackStarted = false;
                // 跟踪视频是否出现bufferAppendError
                let bufferAppendErrorCount = 0;
                // 播放中途的致命错误计数（源站抖动时用来决定"重试"还是"放弃"）
                let midFatalCount = 0;

                // 监听视频播放事件
                video.addEventListener('playing', function () {
                    playbackStarted = true;
                    midFatalCount = 0; // 成功播放即清零，避免历史错误影响后续判断
                    document.getElementById('player-loading').style.display = 'none';
                    document.getElementById('error').style.display = 'none';
                });

                // 监听视频进度事件
                video.addEventListener('timeupdate', function () {
                    if (video.currentTime > 1) {
                        // 视频进度超过1秒，隐藏错误（如果存在）
                        document.getElementById('error').style.display = 'none';
                    }
                });

                let hlsFilteredUrl = url;
                let hlsFellBack = false;
                hls.attachMedia(video);
                buildAdFilteredUrl(url).then(function (playUrl) {
                    hlsFilteredUrl = playUrl;
                    hls.loadSource(playUrl);
                    hls.startLoad();
                }).catch(function () {
                    hls.loadSource(url);
                    hls.startLoad();
                });

                // enable airplay, from https://github.com/video-dev/hls.js/issues/5989
                // 检查是否已存在source元素，如果存在则更新，不存在则创建
                let sourceElement = video.querySelector('source');
                if (sourceElement) {
                    // 更新现有source元素的URL
                    sourceElement.src = videoUrl;
                } else {
                    // 创建新的source元素
                    sourceElement = document.createElement('source');
                    sourceElement.src = videoUrl;
                    video.appendChild(sourceElement);
                }
                video.disableRemotePlayback = false;

                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    video.play().catch(e => {
                    });
                });

                hls.on(Hls.Events.ERROR, function (event, data) {
                    // 切集后旧实例还在收尾，它的报错与当前播放无关，直接丢掉
                    if (window.__currentHls && hls !== window.__currentHls) {
                        return;
                    }
                    // 增加错误计数
                    errorCount++;

                    // 处理bufferAppendError
                    if (data.details === 'bufferAppendError') {
                        bufferAppendErrorCount++;
                        // 如果视频已经开始播放，则忽略这个错误
                        if (playbackStarted) {
                            return;
                        }

                        // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                        if (bufferAppendErrorCount >= 3) {
                            hls.recoverMediaError();
                        }
                    }

                    // 播放中途的致命错误：先原地恢复，连续失败再重载播放列表
                    // （以前只在"还没播起来"时处理，播到一半源站抽风就永远卡住）
                    if (data.fatal && playbackStarted) {
                        midFatalCount++;
                        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && midFatalCount <= 2) {
                            hls.recoverMediaError();
                            return;
                        }
                        if (midFatalCount <= 3) {
                            const resumeAt = video.currentTime;
                            hls.stopLoad();
                            setTimeout(function () {
                                hls.startLoad(resumeAt);
                            }, 800 * midFatalCount);
                            return;
                        }
                        showError('播放中断：源站持续无响应，正在换源');
                        autoSwitchSource();
                        return;
                    }

                    // 如果是致命错误，且视频未播放
                    if (data.fatal && !playbackStarted) {
                        // 尝试恢复错误
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                // 过滤后的地址拉不到（代理异常/源站拒绝），回退原始地址
                                if (!hlsFellBack && hlsFilteredUrl !== url) {
                                    hlsFellBack = true;
                                    hls.loadSource(url);
                                    hls.startLoad();
                                } else if (errorCount <= 3) {
                                    // 最多重试 3 次，别无限 startLoad 转圈
                                    hls.startLoad();
                                } else {
                                    showError('该线路无法播放，正在换源');
                                    autoSwitchSource();
                                }
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls.recoverMediaError();
                                break;
                            default:
                                // 仅在多次恢复尝试后显示错误
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError('视频加载失败，可能是格式不兼容或源不可用');
                                }
                                break;
                        }
                    }
                });

                // 监听分段加载事件
                hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
                    document.getElementById('player-loading').style.display = 'none';
                    try {
                        const st = data && data.frag && data.frag.stats;
                        const n = (st && st.loaded) || (data && data.payload && data.payload.byteLength) || 0;
                        netHudAddBytes(n);
                        netHudRecordFrag(st);
                    } catch (e) { /* 统计失败不影响播放 */ }
                });

                // 监听级别加载事件
                hls.on(Hls.Events.LEVEL_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });
            }
        }
    });

    // artplayer 没有 'fullscreenWeb:enter', 'fullscreenWeb:exit' 等事件
    // 所以原控制栏隐藏代码并没有起作用
    // 实际起作用的是 artplayer 默认行为，它支持自动隐藏工具栏
    // 但有一个 bug： 在副屏全屏时，鼠标移出副屏后不会自动隐藏工具栏
    // 下面进一并重构和修复：
    let hideTimer;

    // 隐藏控制栏
    function hideControls() {
        if (art && art.controls) {
            art.controls.show = false;
        }
    }

    // 重置计时器，计时器超时时间与 artplayer 保持一致
    function resetHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideControls();
        }, Artplayer.CONTROL_HIDE_TIME);
    }

    // 处理鼠标离开浏览器窗口
    function handleMouseOut(e) {
        if (e && !e.relatedTarget) {
            resetHideTimer();
        }
    }

    // 全屏状态切换时注册/移除 mouseout 事件，监听鼠标移出屏幕事件
    // 从而对播放器状态栏进行隐藏倒计时
    function handleFullScreen(isFullScreen, isWeb) {
        if (isFullScreen) {
            document.addEventListener('mouseout', handleMouseOut);
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            // 退出全屏时清理计时器
            clearTimeout(hideTimer);
        }

        if (!isWeb) {
            if (window.screen.orientation && window.screen.orientation.lock) {
                window.screen.orientation.lock('landscape')
                    .then(() => {
                    })
                    .catch((error) => {
                    });
            }
        }
    }

    // 左上角 HUD：artplayer 构造完成后容器就已存在，直接挂上，
    // 不依赖 'ready'（解码失败/格式不支持时 ready 可能永远不来）
    try { netHudStart(); } catch (e) {}

    // 播放器加载完成后初始隐藏工具栏
    art.on('ready', () => {
        hideControls();
        // 左上角 HUD：当前源 + 实时速度
        try { netHudStart(); } catch (e) {}
    });

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        handleFullScreen(isFullScreen, true);
    });

    // 全屏模式处理
    art.on('fullscreen', function (isFullScreen) {
        handleFullScreen(isFullScreen, false);
    });

    art.on('video:loadedmetadata', function() {
        document.getElementById('player-loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志
        // 优先使用URL传递的position参数
        const urlParams = new URLSearchParams(window.location.search);
        const savedPosition = parseInt(urlParams.get('position') || '0');

        if (savedPosition > 10 && savedPosition < art.duration - 2) {
            // 如果URL中有有效的播放位置参数，直接使用它
            art.currentTime = savedPosition;
            showPositionRestoreHint(savedPosition);
        } else {
            // 否则尝试从本地存储恢复播放进度
            try {
                const progressKey = 'videoProgress_' + getVideoId();
                const progressStr = localStorage.getItem(progressKey);
                if (progressStr && art.duration > 0) {
                    const progress = JSON.parse(progressStr);
                    if (
                        progress &&
                        typeof progress.position === 'number' &&
                        progress.position > 10 &&
                        progress.position < art.duration - 2
                    ) {
                        art.currentTime = progress.position;
                        showPositionRestoreHint(progress.position);
                    }
                }
            } catch (e) {
            }
        }

        // 设置进度条点击监听
        setupProgressBarPreciseClicks();

        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);

        // 启动定期保存播放进度
        startProgressSaveInterval();
    })

    // 错误处理
    art.on('video:error', function (error) {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            return;
        }

        // 隐藏所有加载指示器
        const loadingElements = document.querySelectorAll('#player-loading, .player-loading-container');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });

        showError('视频播放失败: ' + (error.message || '未知错误'));
    });

    // 添加移动端长按三倍速播放功能
    setupLongPressSpeedControl();

    // 自动连播预取：播到 75% 时把下一集的 m3u8 拉进浏览器缓存（几 KB），
    // 切集时省掉一次往返；只预取播放列表，不预取分片（避免浪费流量）。
    let prefetchedForIndex = -1;
    if (art && art.video) {
        art.video.addEventListener('timeupdate', function () {
            if (!autoplayEnabled) return;
            if (currentEpisodeIndex >= currentEpisodes.length - 1) return;
            if (!art.video.duration || art.video.currentTime < art.video.duration * 0.75) return;
            if (prefetchedForIndex === currentEpisodeIndex) return;
            prefetchedForIndex = currentEpisodeIndex;
            const nextUrl = currentEpisodes[currentEpisodeIndex + 1];
            if (typeof nextUrl === 'string' && /^https?:\/\//i.test(nextUrl)) {
                fetchPlaylistText(nextUrl).catch(function () {});
            }
        });
    }

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                playNextEpisode();
                videoHasEnded = false; // 重置标志
            }, 1000);
        } else {
            art.fullscreen = false;
        }
    });

    // 添加双击全屏支持
    art.on('video:playing', () => {
        // 绑定双击事件到视频容器
        if (art.video) {
            art.video.addEventListener('dblclick', () => {
                art.fullscreen = !art.fullscreen;
                art.play();
            });
        }
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (art && art.video && art.video.currentTime > 0) {
            return;
        }

        const loadingElement = document.getElementById('player-loading');
        if (loadingElement && loadingElement.style.display !== 'none') {
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// 广告过滤已移到代理层（functions/proxy，?raw=1），这里不再改写 m3u8。
// 原实现是删除所有 #EXT-X-DISCONTINUITY 行，会破坏时间轴（反而造成卡顿/跳帧），
// 保留空实现仅为兼容 CustomHlsJsLoader 的调用。
function filterAdsFromM3U8(m3u8Content) {
    return m3u8Content || '';
}

// 显示错误
function showError(message) {
    // 正在切集：旧实例销毁时的报错不该盖在新一集的画面上
    if (window.isSwitchingVideo) {
        return;
    }
    // 在视频已经播放的情况下不显示错误（用"真的在播"判断，比 currentTime>1 可靠：
    // 切集后 currentTime 归零，旧逻辑会把遮罩盖到已经开播的新一集上）
    if (art && art.video && (!art.video.paused && art.video.readyState >= 2)) {
        return;
    }
    if (art && art.video && art.video.currentTime > 1) {
        return;
    }
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'flex';
    const errorMsgEl = document.getElementById('error-message');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    if (currentEpisodes.length > 0) {
        document.getElementById('episodeInfo').textContent = `第 ${currentEpisodeIndex + 1}/${currentEpisodes.length} 集`;
    } else {
        document.getElementById('episodeInfo').textContent = '无集数信息';
    }
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }

    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        nextButton.setAttribute('disabled', '');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;

        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" 
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    });

    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 获取 sourceCode
    const urlParams2 = new URLSearchParams(window.location.search);
    const sourceCode = urlParams2.get('source_code');

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false; // 重置视频结束标志

    clearVideoProgress();

    // 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    window.history.replaceState({}, '', currentUrl.toString());

    // 切集保护：旧实例/旧源收尾时抛的 error 不该盖在新一集的画面上
    window.isSwitchingVideo = true;
    netHudBitrate = 0;
    netHudCalibrating = false;
    netHudZeroTicks = 0;
    netHudLastBufEnd = 0;
    clearTimeout(window.__switchGuardTimer);
    window.__switchGuardTimer = setTimeout(function () { window.isSwitchingVideo = false; }, 15000);
    const vEl = art && art.video;
    if (vEl) {
        vEl.addEventListener('playing', function () { window.isSwitchingVideo = false; }, { once: true });
    }

    if (isWebkit) {
        initPlayer(url);
    } else {
        art.switch = url;
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    userClickedPosition = null;

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        copyTextToClipboard(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;

    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);

    // 重新渲染集数列表
    renderEpisodes();

    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');

    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}

// 设置进度条准确点击处理
function setupProgressBarPreciseClicks() {
    // 查找DPlayer的进度条元素
    const progressBar = document.querySelector('.dplayer-bar-wrap');
    if (!progressBar || !art || !art.video) return;

    // 移除可能存在的旧事件监听器
    progressBar.removeEventListener('mousedown', handleProgressBarClick);

    // 添加新的事件监听器
    progressBar.addEventListener('mousedown', handleProgressBarClick);

    // 在移动端也添加触摸事件支持
    progressBar.removeEventListener('touchstart', handleProgressBarTouch);
    progressBar.addEventListener('touchstart', handleProgressBarTouch);

    // 处理进度条点击
    function handleProgressBarClick(e) {
        if (!art || !art.video) return;

        // 计算点击位置相对于进度条的比例
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (e.clientX - rect.left) / rect.width;

        // 计算点击位置对应的视频时间
        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            // 如果点击位置非常接近结尾，稍微往前移一点
            clickTime = Math.min(clickTime, duration - 1.5);

        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        // 阻止默认事件传播，避免DPlayer内部逻辑将视频跳至末尾
        e.stopPropagation();

        // 直接设置视频时间
        art.seek(clickTime);
    }

    // 处理移动端触摸事件
    function handleProgressBarTouch(e) {
        if (!art || !art.video || !e.touches[0]) return;

        const touch = e.touches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (touch.clientX - rect.left) / rect.width;

        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            clickTime = Math.min(clickTime, duration - 1.5);
        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        e.stopPropagation();
        art.seek(clickTime);
    }
}

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    // 确保 currentEpisodes 非空且有当前视频URL
    if (!currentEpisodes || currentEpisodes.length === 0 || !currentVideoUrl) {
        return;
    }

    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source') || '';
    const id_from_params = urlParams.get('id'); // Get video ID from player URL (passed as 'id')

    // 获取当前播放进度
    let currentPosition = 0;
    let videoDuration = 0;

    if (art && art.video) {
        currentPosition = art.video.currentTime;
        videoDuration = art.video.duration;
    }

    // Define a show identifier: Prioritize sourceName_id, fallback to first episode URL or current video URL
    let show_identifier_for_video_info;
    if (sourceName && id_from_params) {
        show_identifier_for_video_info = `${sourceName}_${id_from_params}`;
    } else {
        show_identifier_for_video_info = (currentEpisodes && currentEpisodes.length > 0) ? currentEpisodes[0] : currentVideoUrl;
    }

    // 构建要保存的视频信息对象
    const videoInfo = {
        title: currentVideoTitle,
        directVideoUrl: currentVideoUrl, // Current episode's direct URL
        url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&id=${encodeURIComponent(id_from_params || '')}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition || 0)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        vod_id: id_from_params || '', // Store the ID from params as vod_id in history item
        sourceCode: sourceCode,
        showIdentifier: show_identifier_for_video_info, // Identifier for the show/series
        timestamp: Date.now(),
        playbackPosition: currentPosition,
        duration: videoDuration,
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };
    
    try {
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');

        // 检查是否已经存在相同的系列记录 (基于标题、来源和 showIdentifier)
        const existingIndex = history.findIndex(item => 
            item.title === videoInfo.title && 
            item.sourceName === videoInfo.sourceName && 
            item.showIdentifier === videoInfo.showIdentifier
        );

        if (existingIndex !== -1) {
            // 存在则更新现有记录的当前集数、时间戳、播放进度和URL等
            const existingItem = history[existingIndex];
            existingItem.episodeIndex = videoInfo.episodeIndex;
            existingItem.timestamp = videoInfo.timestamp;
            existingItem.sourceName = videoInfo.sourceName; // Should be consistent, but update just in case
            existingItem.sourceCode = videoInfo.sourceCode;
            existingItem.vod_id = videoInfo.vod_id;
            
            // Update URLs to reflect the current episode being watched
            existingItem.directVideoUrl = videoInfo.directVideoUrl; // Current episode's direct URL
            existingItem.url = videoInfo.url; // Player link for the current episode

            // 更新播放进度信息
            existingItem.playbackPosition = videoInfo.playbackPosition > 10 ? videoInfo.playbackPosition : (existingItem.playbackPosition || 0);
            existingItem.duration = videoInfo.duration || existingItem.duration;
            
            // 更新集数列表（如果新的集数列表与存储的不同，例如集数增加了）
            if (videoInfo.episodes && videoInfo.episodes.length > 0) {
                if (!existingItem.episodes || 
                    !Array.isArray(existingItem.episodes) || 
                    existingItem.episodes.length !== videoInfo.episodes.length || 
                    !videoInfo.episodes.every((ep, i) => ep === existingItem.episodes[i])) { // Basic check for content change
                    existingItem.episodes = [...videoInfo.episodes]; // Deep copy
                }
            }
            
            // 移到最前面
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 添加新记录到最前面
            history.unshift(videoInfo);
        }

        // 限制历史记录数量为50条
        if (history.length > 50) history.splice(50);

        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
    }
}

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;

    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;

    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container'); // Ensure this selector is correct
    if (playerContainer) { // Check if playerContainer exists
        playerContainer.appendChild(hint);
    } else {
        return; // Exit if container not found
    }

    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');

        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
    }

    // 每30秒保存一次播放进度
    progressSaveInterval = setInterval(saveCurrentProgress, 30000);
}

// 保存当前播放进度
function saveCurrentProgress() {
    if (!art || !art.video) return;
    const currentTime = art.video.currentTime;
    const duration = art.video.duration;
    if (!duration || currentTime < 1) return;

    // 在localStorage中保存进度
    const progressKey = `videoProgress_${getVideoId()}`;
    const progressData = {
        position: currentTime,
        duration: duration,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        // --- 新增：同步更新 viewingHistory 中的进度 ---
        try {
            const historyRaw = localStorage.getItem('viewingHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                // 用 title + 集数索引唯一标识
                const idx = history.findIndex(item =>
                    item.title === currentVideoTitle &&
                    (item.episodeIndex === undefined || item.episodeIndex === currentEpisodeIndex)
                );
                if (idx !== -1) {
                    // 只在进度有明显变化时才更新，减少写入
                    if (
                        Math.abs((history[idx].playbackPosition || 0) - currentTime) > 2 ||
                        Math.abs((history[idx].duration || 0) - duration) > 2
                    ) {
                        history[idx].playbackPosition = currentTime;
                        history[idx].duration = duration;
                        history[idx].timestamp = Date.now();
                        localStorage.setItem('viewingHistory', JSON.stringify(history));
                    }
                }
            }
        } catch (e) {
        }
    } catch (e) {
    }
}

// 设置移动端长按三倍速播放功能
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键
        if (isMobile) {
            const dplayerMenu = document.querySelector(".dplayer-menu");
            const dplayerMask = document.querySelector(".dplayer-mask");
            if (dplayerMenu) dplayerMenu.style.display = "none";
            if (dplayerMask) dplayerMask.style.display = "none";
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (art.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 保存原始播放速度
        originalPlaybackRate = art.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (art.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速
            art.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 视频暂停时取消长按状态
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
    } catch (e) {
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    // If currentVideoUrl is available and more unique, prefer it. Otherwise, fallback.
    if (currentVideoUrl) {
        return `${encodeURIComponent(currentVideoUrl)}`;
    }
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    // Artplayer 的点击/手势判定都带 !e.isLock 守卫（见 libs/artplayer.min.js），
    // 置上它才能让移动端真正“锁住”（否则点屏幕仍会暂停、滑动仍会快进）。
    // 桌面端鼠标点击不受 isLock 约束，那边靠下面的 .controls-locked 样式把控制栏藏掉。
    // 注：Artplayer 自带的 lock 组件只在「移动端 + lock:true」时才注册，且会额外挂一个锁图标图层，
    // 这里不用它，避免多出一套与页面按钮重复的 UI。
    if (art) {
        art.isLock = controlsLocked;
    }
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8H6v-6z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}

// 支持在iframe中关闭播放器
function closeEmbeddedPlayer() {
    try {
        if (window.self !== window.top) {
            // 如果在iframe中，尝试调用父窗口的关闭方法
            if (window.parent && typeof window.parent.closeVideoPlayer === 'function') {
                window.parent.closeVideoPlayer();
                return true;
            }
        }
    } catch (e) {
        console.error('尝试关闭嵌入式播放器失败:', e);
    }
    return false;
}

function renderResourceInfoBar() {
    // 获取容器元素
    const container = document.getElementById('resourceInfoBarContainer');
    if (!container) {
        console.error('找不到资源信息卡片容器');
        return;
    }
    
    // 获取当前视频 source_code
    const urlParams = new URLSearchParams(window.location.search);
    const currentSource = urlParams.get('source') || '';
    
    // 显示临时加载状态
    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>加载中...</span>
        <span class="resource-info-bar-videos">-</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;

    // 查找当前源名称，从 API_SITES 和 custom_api 中查找即可
    let resourceName = currentSource
    if (currentSource && API_SITES[currentSource]) {
        resourceName = API_SITES[currentSource].name;
    }
    if (resourceName === currentSource) {
        const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
        const customIndex = parseInt(currentSource.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            resourceName = customAPIs[customIndex].name || '自定义资源';
        }
    }

    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>${resourceName}</span>
        <span class="resource-info-bar-videos">${currentEpisodes.length} 个视频</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;
}

// 测试视频源速率的函数
async function testVideoSourceSpeed(sourceKey, vodId) {
    try {
        const startTime = performance.now();
        
        // 构建API参数
        let apiParams = '';
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                return { speed: -1, error: 'API配置无效' };
            }
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            apiParams = '&source=' + sourceKey;
        }
        
        // 添加时间戳防止缓存
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        
        // 获取视频详情
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`, {
            method: 'GET',
            cache: 'no-cache'
        });
        
        if (!response.ok) {
            return { speed: -1, error: '获取失败' };
        }
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            return { speed: -1, error: '无播放源' };
        }
        
        // 测试第一个播放链接的响应速度
        const firstEpisodeUrl = data.episodes[0];
        if (!firstEpisodeUrl) {
            return { speed: -1, error: '链接无效' };
        }
        
        // 测试视频链接响应时间
        const videoTestStart = performance.now();
        try {
            // AbortSignal 的 timeout() 静态方法自 Safari 16 起才有，iOS 13.5 上不存在
            // （调用即 TypeError），这里改用 AbortController + setTimeout。
            const videoController = new AbortController();
            const videoTimeoutId = setTimeout(() => videoController.abort(), 5000);
            const videoResponse = await fetch(firstEpisodeUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-cache',
                signal: videoController.signal
            }).finally(() => clearTimeout(videoTimeoutId));
            
            const videoTestEnd = performance.now();
            const totalTime = videoTestEnd - startTime;
            
            // 返回总响应时间（毫秒）
            return { 
                speed: Math.round(totalTime),
                episodes: data.episodes.length,
                error: null 
            };
        } catch (videoError) {
            // 如果视频链接测试失败，只返回API响应时间
            const apiTime = performance.now() - startTime;
            return { 
                speed: Math.round(apiTime),
                episodes: data.episodes.length,
                error: null,
                note: 'API响应' 
            };
        }
        
    } catch (error) {
        return { 
            speed: -1, 
            error: error.name === 'AbortError' ? '超时' : '测试失败' 
        };
    }
}

// 格式化速度显示
function formatSpeedDisplay(speedResult) {
    if (speedResult.speed === -1) {
        return `<span class="speed-indicator error">❌ ${speedResult.error}</span>`;
    }
    
    const speed = speedResult.speed;
    let className = 'speed-indicator good';
    let icon = '🟢';
    
    if (speed > 2000) {
        className = 'speed-indicator poor';
        icon = '🔴';
    } else if (speed > 1000) {
        className = 'speed-indicator medium';
        icon = '🟡';
    }
    
    const note = speedResult.note ? ` (${speedResult.note})` : '';
    return `<span class="${className}">${icon} ${speed}ms${note}</span>`;
}

// 自动换源：当前线路彻底不可用时，找同名资源的下一条线路并切过去。
// 只在一次播放会话里尝试一次，避免在两条烂线路之间来回跳。
let autoSwitchedThisSession = false;
async function autoSwitchSource() {
    if (autoSwitchedThisSession) {
        showError('播放中断：所有线路均不可用');
        return;
    }
    autoSwitchedThisSession = true;
    showToast('当前线路不可用，正在自动换源…', 'info');
    const curSource = new URLSearchParams(window.location.search).get('source') || '';
    try {
        const pool = (Array.isArray(selectedAPIs) && selectedAPIs.length)
            ? selectedAPIs
            : Object.keys(API_SITES);
        const keys = pool.filter((k) => String(k) !== String(curSource));
        for (const key of keys) {
            try {
                const results = await searchByAPIAndKeyWord(key, currentVideoTitle);
                if (!results || !results.length) continue;
                const hit = results.find((r) => r.vod_name === currentVideoTitle) || results[0];
                if (hit && hit.vod_id) {
                    await switchToResource(key, hit.vod_id);
                    return;
                }
            } catch (e) {
                // 这条线路搜索失败，继续下一条
            }
        }
        showError('播放中断：所有线路均不可用');
    } catch (e) {
        showError('播放中断：换源失败');
    }
}

// 给任意 promise 加超时：慢源不会拖住整个列表
function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
        let settled = false;
        const timer = setTimeout(function () {
            if (!settled) { settled = true; resolve(fallback); }
        }, ms);
        Promise.resolve(promise).then(function (v) {
            if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
        }).catch(function () {
            if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); }
        });
    });
}

async function showSwitchResourceModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    // 资源列表
    const resourceOptions = selectedAPIs.map(function (curr) {
        if (API_SITES[curr]) {
            return { key: curr, name: API_SITES[curr].name };
        }
        const customIndex = parseInt(curr.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            return { key: curr, name: customAPIs[customIndex].name || '自定义资源' };
        }
        return { key: curr, name: '未知资源' };
    });

    modalTitle.innerHTML = `<span class="break-words">${escapeHtml(currentVideoTitle)}</span>`;
    modalContent.innerHTML = `
        <div class="flex items-center justify-between px-1 pb-3 text-xs text-gray-400">
            <span id="switchStatus">正在搜索 ${resourceOptions.length} 个资源…</span>
            <span id="switchCount">0/${resourceOptions.length}</span>
        </div>
        <div id="switchGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"></div>`;
    modal.classList.remove('hidden');

    const ready = [];
    let done = 0;

    const isCurrent = function (entry) {
        return String(entry.key) === String(currentSourceCode) &&
            String(entry.result.vod_id) === String(currentVideoId);
    };

    const cardHtml = function (entry) {
        const cur = isCurrent(entry);
        const sp = entry.speedResult;
        const speedHtml = sp ? formatSpeedDisplay(sp)
            : '<span class="speed-indicator medium">⏳ 测速中</span>';
        return `
            <div class="relative group ${cur ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 transition-transform'}"
                 ${!cur ? `onclick="switchToResource('${entry.key}', '${entry.result.vod_id}')"` : ''}>
                <div class="aspect-[2/3] rounded-lg overflow-hidden bg-gray-800 relative">
                    <img src="${entry.result.vod_pic}"
                         alt="${entry.result.vod_name}"
                         class="w-full h-full object-cover"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiPjwvcmVjdD48cGF0aCBkPSJNMjEgMTV2NGEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMnYtNCI+PC9wYXRoPjxwb2x5bGluZSBwb2ludHM9IjE3IDggMTIgMyA3IDgiPjwvcG9seWxpbmU+PHBhdGggZD0iTTEyIDN2MTIiPjwvcGF0aD48L3N2Zz4='">
                    <div class="absolute top-1 right-1 speed-badge bg-black bg-opacity-75">
                        ${speedHtml}
                    </div>
                </div>
                <div class="mt-2">
                    <div class="text-xs font-medium text-gray-200 truncate">${entry.result.vod_name}</div>
                    <div class="text-[10px] text-gray-400 truncate">${entry.name}</div>
                    <div class="text-[10px] text-gray-500 mt-1">
                        ${sp && sp.episodes ? `${sp.episodes}集` : ''}
                    </div>
                </div>
                ${cur ? `
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div class="bg-blue-600 bg-opacity-75 rounded-lg px-2 py-0.5 text-xs text-white font-medium">
                            当前播放
                        </div>
                    </div>
                ` : ''}
            </div>`;
    };

    const renderGrid = function () {
        const grid = document.getElementById('switchGrid');
        if (!grid) return;
        ready.sort(function (a, b) {
            const ca = isCurrent(a), cb = isCurrent(b);
            if (ca && !cb) return -1;
            if (!ca && cb) return 1;
            // 还没测出速度的排在已测出的后面（避免卡片来回跳）
            const sa = a.speedResult ? (a.speedResult.speed === -1 ? 99998 : a.speedResult.speed) : 99999;
            const sb = b.speedResult ? (b.speedResult.speed === -1 ? 99998 : b.speedResult.speed) : 99999;
            return sa - sb;
        });
        grid.innerHTML = ready.map(cardHtml).join('');
    };

    // 每个源独立跑：搜到就先把卡片放出来，测完速再更新这一张
    resourceOptions.forEach(function (opt) {
        (async function () {
            try {
                const q = await withTimeout(searchByAPIAndKeyWord(opt.key, currentVideoTitle), 12000, null);
                if (!q || !q.length) return;
                let result = q[0];
                q.forEach(function (res) { if (res.vod_name == currentVideoTitle) result = res; });
                if (!result || !result.vod_id) return;

                const entry = { key: opt.key, name: opt.name, result: result, speedResult: null };
                ready.push(entry);
                renderGrid();   // 先显示"测速中"

                const sp = await withTimeout(testVideoSourceSpeed(opt.key, result.vod_id), 9000, { speed: -1, error: '超时' });
                entry.speedResult = sp;
                renderGrid();
            } catch (e) {
                // 单个源失败不影响其它
            } finally {
                done++;
                const cnt = document.getElementById('switchCount');
                if (cnt) cnt.textContent = `${done}/${resourceOptions.length}`;
                if (done === resourceOptions.length) {
                    const st = document.getElementById('switchStatus');
                    if (st) st.textContent = ready.length ? `共 ${ready.length} 个可用资源` : '没有找到其它资源';
                    if (!ready.length) {
                        const grid = document.getElementById('switchGrid');
                        if (grid) grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有找到同名资源</div>';
                    }
                }
            }
        })();
    });
}

// 切换资源的函数
async function switchToResource(sourceKey, vodId) {
    // 关闭模态框
    document.getElementById('modal').classList.add('hidden');
    
    showLoading();
    try {
        // 构建API参数
        let apiParams = '';
        
        // 处理自定义API源
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                hideLoading();
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceKey;
        }
        
        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`);
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            showToast('未找到播放资源', 'error');
            hideLoading();
            return;
        }

        // 获取当前播放的集数索引
        const currentIndex = currentEpisodeIndex;
        
        // 确定要播放的集数索引
        let targetIndex = 0;
        if (currentIndex < data.episodes.length) {
            // 如果当前集数在新资源中存在，则使用相同集数
            targetIndex = currentIndex;
        }
        
        // 获取目标集数的URL
        const targetUrl = data.episodes[targetIndex];
        
        // 构建播放页面URL
        const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}`;
        
        // 保存当前状态到localStorage
        try {
            localStorage.setItem('currentVideoTitle', data.vod_name || '未知视频');
            localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
            localStorage.setItem('currentEpisodeIndex', targetIndex);
            localStorage.setItem('currentSourceCode', sourceKey);
            localStorage.setItem('lastPlayTime', Date.now());
        } catch (e) {
            console.error('保存播放状态失败:', e);
        }

        // 跳转到播放页面
        window.location.href = watchUrl;
        
    } catch (error) {
        console.error('切换资源失败:', error);
        showToast('切换资源失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}