// 直播页逻辑：订阅社区 m3u 列表 → 解析分组 → 点频道即播
// 所有流地址都经 /proxy 转一手：一是很多直播源是 http，HTTPS 页面直连会被混合内容拦掉；
// 二是顺带解决 CORS 和 Referer 防盗链。

let liveChannels = [];      // {name, url, logo, group}
let liveGroups = [];        // [groupName]
let liveCurrentGroup = '全部';
let liveKeyword = '';
let liveArt = null;
let liveHls = null;
let liveCurrent = null;
let liveDead = new Set();     // 检测不通的频道
let liveChecking = false;

const LIVE_PREFS_KEY = 'livePrefs';

function livePrefs() {
    try {
        return JSON.parse(localStorage.getItem(LIVE_PREFS_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function saveLivePrefs(patch) {
    try {
        localStorage.setItem(LIVE_PREFS_KEY, JSON.stringify(Object.assign(livePrefs(), patch)));
    } catch (e) {}
}

function liveProxy(url) {
    return '/proxy/' + encodeURIComponent(url);
}

// ---- 解析 m3u ----
function parseM3U(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let meta = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF')) {
            const name = (line.split(',').pop() || '').trim();
            const logo = (line.match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
            const group = (line.match(/group-title="([^"]*)"/i) || [])[1] || '未分组';
            meta = { name: name, logo: logo, group: group };
            continue;
        }
        if (line.startsWith('#EXTGRP:')) {
            if (meta) meta.group = line.slice(8).trim() || meta.group;
            continue;
        }
        if (line.startsWith('#')) continue;
        if (!/^https?:\/\//i.test(line)) { meta = null; continue; }   // 跳过 rtp/udp/rtsp
        if (!meta) continue;
        out.push({ name: meta.name || '未命名', url: line, logo: meta.logo, group: meta.group });
        meta = null;
    }
    return out;
}

// ---- 拉取列表 ----
async function loadLiveSource(index) {
    const src = (typeof LIVE_SOURCES !== 'undefined' ? LIVE_SOURCES : [])[index];
    if (!src) return;
    setStatus('正在拉取「' + src.name + '」…');
    liveChannels = [];
    renderGroups();
    renderChannels();
    try {
        const res = await fetch(liveProxy(src.url), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const list = parseM3U(text);
        if (!list.length) throw new Error('没有解析到频道');
        liveChannels = list;
        liveGroups = ['全部'].concat(Array.from(new Set(list.map(function (c) { return c.group; }))));
        liveCurrentGroup = '全部';
        setStatus('共 ' + list.length + ' 个频道 · ' + (liveGroups.length - 1) + ' 个分组');
        renderGroups();
        renderChannels();
        saveLivePrefs({ sourceIndex: index });
    } catch (e) {
        setStatus('拉取失败：' + (e.message || e) + '（试试换一个源）');
    }
}

function setStatus(msg) {
    const el = document.getElementById('liveStatus');
    if (el) el.textContent = msg;
}

// ---- 渲染 ----
function renderGroups() {
    const box = document.getElementById('liveGroups');
    if (!box) return;
    box.innerHTML = liveGroups.map(function (g) {
        const active = g === liveCurrentGroup;
        return '<button class="live-chip' + (active ? ' active' : '') + '" onclick="selectLiveGroup(\'' +
            String(g).replace(/'/g, "\\'") + '\')">' + escapeHtmlLive(g) + '</button>';
    }).join('');
}

function renderChannels() {
    const box = document.getElementById('liveList');
    if (!box) return;
    const kw = liveKeyword.trim().toLowerCase();
    const list = liveChannels.filter(function (c) {
        if (liveCurrentGroup !== '全部' && c.group !== liveCurrentGroup) return false;
        if (kw && c.name.toLowerCase().indexOf(kw) === -1) return false;
        return true;
    });
    if (!list.length) {
        box.innerHTML = '<div class="live-empty">没有匹配的频道</div>';
        return;
    }
    box.innerHTML = list.map(function (c) {
        const active = liveCurrent && liveCurrent.url === c.url;
        const dead = liveDead.has(c.url);
        const logo = c.logo
            ? '<img src="' + escapeHtmlLive(c.logo) + '" loading="lazy" onerror="this.style.display=\'none\'">'
            : '<span class="live-dot"></span>';
        return '<button class="live-item' + (active ? ' active' : '') + (dead ? ' dead' : '') + '" onclick="playLive(' +
            list.indexOf(c) + ')" data-url="' + escapeHtmlLive(c.url) + '">' + logo +
            '<span class="live-name">' + escapeHtmlLive(c.name) + '</span></button>';
    }).join('');
    // 用过滤后的下标回调会错位，改成按 data-url 查找
    Array.from(box.querySelectorAll('.live-item')).forEach(function (el) {
        el.onclick = function () {
            const u = el.getAttribute('data-url');
            const ch = liveChannels.find(function (c) { return c.url === u; });
            if (ch) playLiveChannel(ch);
        };
    });
}

// 批量检测当前可见频道的可用性（并发 5，单个 6 秒超时）
async function checkVisibleChannels() {
    if (liveChecking) return;
    liveChecking = true;
    setStatus('正在检测…');
    const kw = liveKeyword.trim().toLowerCase();
    const list = liveChannels.filter(function (c) {
        if (liveCurrentGroup !== '全部' && c.group !== liveCurrentGroup) return false;
        if (kw && c.name.toLowerCase().indexOf(kw) === -1) return false;
        return true;
    }).slice(0, 40);

    let i = 0, ok = 0, dead = 0;
    async function worker() {
        while (i < list.length) {
            const ch = list[i++];
            try {
                const ctrl = new AbortController();
                const tid = setTimeout(function () { ctrl.abort(); }, 6000);
                const r = await fetch(liveProxy(ch.url), { signal: ctrl.signal, cache: 'no-store' });
                const head = (await r.text()).slice(0, 7);
                clearTimeout(tid);
                if (r.ok && head === '#EXTM3U') { ok++; liveDead.delete(ch.url); }
                else { dead++; liveDead.add(ch.url); }
            } catch (e) {
                dead++; liveDead.add(ch.url);
            }
            renderChannels();
            setStatus('检测中 ' + (ok + dead) + '/' + list.length + ' · 可用 ' + ok);
        }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);
    setStatus('检测完成：可用 ' + ok + ' · 不可用 ' + dead);
    liveChecking = false;
}

function escapeHtmlLive(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function selectLiveGroup(g) {
    liveCurrentGroup = g;
    renderGroups();
    renderChannels();
}

function filterLive(v) {
    liveKeyword = v || '';
    renderChannels();
}

// ---- 播放 ----
function playLive(index) {
    const ch = liveChannels[index];
    if (ch) playLiveChannel(ch);
}

function playLiveChannel(ch) {
    liveCurrent = ch;
    renderChannels();
    setStatus('正在连接 ' + ch.name + ' …');
    const title = document.getElementById('liveNow');
    if (title) title.textContent = ch.name + ' · ' + ch.group;
    saveLivePrefs({ lastUrl: ch.url, lastSourceIndex: livePrefs().sourceIndex || 0 });

    const src = liveProxy(ch.url);
    if (liveArt) {
        try { liveArt.destroy(); } catch (e) {}
        liveArt = null;
    }
    if (liveHls) {
        try { liveHls.destroy(); } catch (e) {}
        liveHls = null;
    }

    const holder = document.getElementById('livePlayer');
    holder.innerHTML = '';
    liveArt = new Artplayer({
        container: holder,
        url: src,
        type: 'm3u8',
        title: ch.name,
        isLive: true,
        autoplay: true,
        muted: false,
        playsInline: true,
        fullscreen: true,
        fullscreenWeb: true,
        pip: true,
        setting: true,
        playbackRate: false,
        miniProgressBar: false,
        theme: '#23ade5',
        customType: {
            m3u8: function (video, url) {
                if (liveHls) { try { liveHls.destroy(); } catch (e) {} }
                const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
                const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) ||
                    /iPad|iPhone|iPod/.test(navigator.userAgent);
                if ((safari || !window.Hls || !Hls.isSupported()) && nativeHls) {
                    video.src = url;   // iOS/Safari 原生 HLS
                    video.play().catch(function () {});
                    return;
                }
                const h = new Hls({
                    lowLatencyMode: false,
                    liveSyncDurationCount: 3,
                    maxBufferLength: 30,
                    manifestLoadingMaxRetry: 4,
                    fragLoadingMaxRetry: 6
                });
                liveHls = h;
                h.loadSource(url);
                h.attachMedia(video);
                let parsed = false;
                h.on(Hls.Events.MANIFEST_PARSED, function () {
                    parsed = true;
                    clearTimeout(watchdog);
                    setStatus('直播中 · ' + ch.name);
                    video.play().catch(function () {});
                });
                // 10 秒还拉不到清单：判定这条源不通，标灰并提示
                const watchdog = setTimeout(function () {
                    if (!parsed) {
                        liveDead.add(ch.url);
                        renderChannels();
                        setStatus('「' + ch.name + '」无响应，换一个频道试试');
                    }
                }, 10000);
                h.on(Hls.Events.ERROR, function (e, data) {
                    if (!data.fatal) return;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
                    else {
                        liveDead.add(ch.url);
                        renderChannels();
                        setStatus('「' + ch.name + '」播放失败，换一个频道试试');
                    }
                });
            }
        }
    });
}

// ---- 初始化 ----
document.addEventListener('DOMContentLoaded', function () {
    const sel = document.getElementById('liveSourceSel');
    if (sel && typeof LIVE_SOURCES !== 'undefined') {
        sel.innerHTML = LIVE_SOURCES.map(function (s, i) {
            return '<option value="' + i + '">' + escapeHtmlLive(s.name) + '</option>';
        }).join('');
        sel.onchange = function () { loadLiveSource(Number(sel.value)); };
    }
    const prefs = livePrefs();
    const idx = Number(prefs.sourceIndex || 0);
    if (sel) sel.value = String(idx);
    loadLiveSource(idx).then(function () {
        if (prefs.lastUrl) {
            const ch = liveChannels.find(function (c) { return c.url === prefs.lastUrl; });
            if (ch) playLiveChannel(ch);
        }
    });
});
