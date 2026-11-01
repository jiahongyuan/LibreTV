/**
 * 首页「源分类浏览」
 * =================================================================
 * 用各采集站自己的分类接口（?ac=class）生成标签，按分类拉取内容。
 * 替代原来的豆瓣热门区（豆瓣接口在国内网络下不稳定，且封面要走代理）。
 *
 * 兼容目标：iOS 13.1 / Safari 13.1
 *   - 不使用 ?. / ?? / Array.at / replaceAll 等 13.1 之后的语法与 API
 *   - 封面若是 http:// 走 /proxy 转 https，避免混合内容被拦
 *   - 海报容器沿用 .aspect-[2/3]，旧引擎由 legacy-aspect.js 补显式高度
 */
(function () {
    'use strict';

    var CLASS_CACHE_KEY = 'browseClassCache_v2';
    var CLASS_TTL = 6 * 60 * 60 * 1000;
    // 采集站固定 20 条/源页，且忽略 limit 参数（实测 ikun/mdzy/光速都是 20），
    // 所以「每页 24 条」靠前端把源页拼起来再切窗口实现。
    var SOURCE_PAGE_SIZE = 20;
    var PER_PAGE = 24;

    var state = {
        sources: [],      // [{key, name, api}]
        source: null,     // 当前源 key
        classes: [],      // [{type_id, type_name}]
        classId: null,
        className: '',
        page: 1,
        sort: 'latest',   // latest | hot
        totalPages: 1,
        loading: false,
        buffer: [],       // 已拉取的条目（跨源页累积）
        loadedPages: 0,   // 已拉取到第几个源页
        total: 0,
        atEnd: false
    };

    function el(id) { return document.getElementById(id); }

    function cleanName(name) {
        return String(name || '').replace(/^🎬\s*-?\s*/, '').replace(/^-+|-+$/g, '').trim();
    }

    function apiFor(key) {
        if (key.indexOf('custom_') === 0) {
            var idx = key.replace('custom_', '');
            var custom = (typeof getCustomApiInfo === 'function') ? getCustomApiInfo(idx) : null;
            return custom ? custom.url : null;
        }
        return (window.API_SITES && window.API_SITES[key]) ? window.API_SITES[key].api : null;
    }

    function nameFor(key) {
        if (key.indexOf('custom_') === 0) {
            var idx = key.replace('custom_', '');
            var custom = (typeof getCustomApiInfo === 'function') ? getCustomApiInfo(idx) : null;
            return custom ? (custom.name || ('自定义源 ' + (Number(idx) + 1))) : key;
        }
        return (window.API_SITES && window.API_SITES[key]) ? cleanName(window.API_SITES[key].name) : key;
    }

    function joinUrl(api, query) {
        var base = String(api || '').replace(/\/+$/, '');
        return base + '/' + query;
    }

    async function proxyFetch(target, timeoutMs) {
        var url = '/proxy/' + encodeURIComponent(target);
        if (window.ProxyAuth && window.ProxyAuth.addAuthToProxyUrl) {
            url = await window.ProxyAuth.addAuthToProxyUrl(url);
        }
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
        try {
            var resp = await fetch(url, { signal: controller.signal });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return await resp.json();
        } finally {
            clearTimeout(timer);
        }
    }

    function readCache() {
        try {
            var raw = localStorage.getItem(CLASS_CACHE_KEY);
            if (!raw) return {};
            var data = JSON.parse(raw);
            var now = Date.now();
            var out = {};
            Object.keys(data).forEach(function (k) {
                if (data[k] && now - data[k].ts < CLASS_TTL) out[k] = data[k];
            });
            return out;
        } catch (e) {
            return {};
        }
    }

    function writeCache(all) {
        try { localStorage.setItem(CLASS_CACHE_KEY, JSON.stringify(all)); } catch (e) { /* 配额满就放弃 */ }
    }

    async function fetchClasses(sourceKey) {
        var cache = readCache();
        if (cache[sourceKey] && cache[sourceKey].classes && cache[sourceKey].classes.length) {
            return cache[sourceKey].classes;
        }
        var api = apiFor(sourceKey);
        if (!api) return [];
        var data = await proxyFetch(joinUrl(api, '?ac=class'), 15000);
        var raw = (data && Array.isArray(data.class)) ? data.class : [];
        // ⚠️ 实测：这批采集站的「顶级分类」type_id 不映射到实际数据
        // （茅台 t=1 只有 4 条、iKun t=1 返回 0），只有子分类 type_id 才能筛出内容。
        // 所以标签一律取 type_pid != 0 的子分类。
        var subs = raw.filter(function (c) { return String(c.type_pid) !== '0'; });
        if (!subs.length) subs = raw;
        var blocked = /伦理|里番|情色|色情|福利|写真|成人|三级|无码|有码|偷拍|少妇|自慰|淫/;
        var seen = {};
        var classes = [{ type_id: null, type_name: '最新' }];
        subs.forEach(function (c) {
            var name = String(c.type_name || '').trim();
            if (!name || blocked.test(name) || seen[name]) return;
            seen[name] = 1;
            classes.push({ type_id: c.type_id, type_name: name });
        });
        classes = classes.slice(0, 30);

        cache[sourceKey] = { ts: Date.now(), classes: classes };
        writeCache(cache);
        return classes;
    }

    async function fetchSourcePage(sourceKey, classId, page) {
        var api = apiFor(sourceKey);
        if (!api) return { list: [], total: 0 };
        var query = (classId === null || classId === undefined)
            ? '?ac=videolist&pg=' + page
            : '?ac=videolist&t=' + encodeURIComponent(classId) + '&pg=' + page;
        var data = await proxyFetch(joinUrl(api, query), 20000);
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        // 剔除采集站里的占位/测试条目
        list = list.filter(function (it) {
            var n = String(it.vod_name || '');
            return n && !/请勿删除|测试专用|同步图片/.test(n);
        });
        return {
            list: list,
            total: Number(data && data.total) || 0,
            pagecount: Number(data && data.pagecount) || 0
        };
    }

    function coverUrl(pic) {
        var src = String(pic || '');
        if (!src) return '';
        if (/^https:\/\//i.test(src)) return src;
        if (/^http:\/\//i.test(src)) return '/proxy/' + encodeURIComponent(src);
        if (src.indexOf('//') === 0) return 'https:' + src;
        return src;
    }

    function renderSources() {
        var box = el('browse-sources');
        if (!box) return;
        box.innerHTML = state.sources.map(function (s) {
            var active = s.key === state.source;
            var cls = active
                ? 'px-3 py-1 text-sm rounded-full bg-white text-black whitespace-nowrap'
                : 'px-3 py-1 text-sm rounded-full bg-[#222] text-gray-300 whitespace-nowrap';
            return '<button class="' + cls + '" data-source="' + escapeHtml(s.key) + '">' +
                escapeHtml(s.name) + '</button>';
        }).join('');
        var buttons = box.querySelectorAll('button[data-source]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function () {
                selectSource(this.getAttribute('data-source'));
            });
        }
    }

    function renderClasses() {
        var box = el('browse-classes');
        if (!box) return;
        if (!state.classes.length) {
            box.innerHTML = '<span class="text-sm text-gray-500">该源没有可用的分类</span>';
            return;
        }
        box.innerHTML = state.classes.map(function (c) {
            var key = (c.type_id === null || c.type_id === undefined) ? 'latest' : String(c.type_id);
            var active = (key === 'latest') ? (state.classId === null)
                : (String(c.type_id) === String(state.classId));
            var cls = active
                ? 'px-3 py-1 text-sm rounded-full bg-pink-600 text-white whitespace-nowrap'
                : 'px-3 py-1 text-sm rounded-full bg-[#1a1a1a] text-gray-300 whitespace-nowrap';
            return '<button class="' + cls + '" data-class="' + escapeHtml(key) + '">' +
                escapeHtml(c.type_name) + '</button>';
        }).join('');
        var buttons = box.querySelectorAll('button[data-class]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function () {
                selectClass(this.getAttribute('data-class'));
            });
        }
    }

    function cardHtml(item) {
        var id = String(item.vod_id || '');
        var name = String(item.vod_name || '');
        var pic = coverUrl(item.vod_pic);
        var remark = String(item.vod_remarks || '');
        var img = pic
            ? '<img src="' + escapeHtml(pic) + '" alt="' + escapeHtml(name) + '" loading="lazy" ' +
              'class="w-full h-full object-cover" ' +
              'onerror="this.onerror=null;this.style.opacity=0;">'
            : '<div class="w-full h-full flex items-center justify-center text-xs text-gray-600">无封面</div>';
        return '<div class="bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden cursor-pointer" ' +
            'onclick="showDetails(\'' + escapeJsAttr(id) + '\',\'' + escapeJsAttr(name) + '\',\'' +
            escapeJsAttr(state.source) + '\')">' +
            '<div class="relative w-full aspect-[2/3] overflow-hidden bg-[#0a0a0a]">' + img +
            '<span class="douban-rate absolute top-1 right-1 hidden bg-[#f5c518] text-black text-xs font-bold px-1.5 py-0.5 rounded" ' +
            'data-title="' + escapeHtml(name) + '"></span>' +
            '</div>' +
            '<div class="p-2">' +
            '<h3 class="text-sm font-medium text-white line-clamp-2 mb-1" title="' + escapeHtml(name) + '">' +
            escapeHtml(name) + '</h3>' +
            (remark ? '<p class="text-xs text-gray-500 line-clamp-1">' + escapeHtml(remark) + '</p>' : '') +
            '</div></div>';
    }

    // ---------------- 豆瓣评分（走 /api/douban 批量接口 + 本地缓存） ----------------
    var RATE_CACHE_KEY = 'doubanRate_v3';
    var rateCache = null;

    function loadRateCache() {
        if (rateCache) return rateCache;
        try { rateCache = JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || '{}') || {}; }
        catch (e) { rateCache = {}; }
        return rateCache;
    }

    function saveRateCache() {
        try {
            var keys = Object.keys(rateCache);
            if (keys.length > 800) {
                var trimmed = {};
                keys.slice(-800).forEach(function (k) { trimmed[k] = rateCache[k]; });
                rateCache = trimmed;
            }
            localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(rateCache));
        } catch (e) { /* 配额满就算了 */ }
    }

    function applyRate(title, rate) {
        var nodes = document.querySelectorAll('.douban-rate');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute('data-title') === title) {
                nodes[i].textContent = rate;
                nodes[i].classList.remove('hidden');
            }
        }
    }

    // 一次把整页缺的片名打包给 /api/douban，避免浏览器直连豆瓣被限流
    function observeRates(container) {
        var nodes = container.querySelectorAll('.douban-rate');
        if (!nodes.length) return;
        var cache = loadRateCache();
        var pending = [];
        for (var i = 0; i < nodes.length; i++) {
            var t = nodes[i].getAttribute('data-title');
            if (!t) continue;
            if (Object.prototype.hasOwnProperty.call(cache, t)) {
                if (cache[t]) applyRate(t, cache[t]);
                continue;
            }
            if (pending.indexOf(t) < 0) pending.push(t);
        }
        if (!pending.length) return;
        fetch('/api/douban?t=' + encodeURIComponent(pending.join('|')), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (map) {
                if (!map) return;
                for (var k in map) {
                    if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
                    cache[k] = map[k];
                    if (map[k]) applyRate(k, map[k]);
                }
                saveRateCache();
            })
            .catch(function () { /* 忽略，下次再查 */ });
    }

    function renderVideos(list, append) {
        var box = el('browse-results');
        if (!box) return;
        var html = list.map(cardHtml).join('');
        if (append) box.insertAdjacentHTML('beforeend', html);
        else box.innerHTML = html;
        if (window.__legacyAspectFix) {
            window.__legacyAspectFix();
            setTimeout(window.__legacyAspectFix, 60);
        }
        observeRates(box);
    }

    function setStatus(text) {
        var box = el('browse-status');
        if (box) box.textContent = text || '';
    }

    function renderPager() {
        var box = el('browse-pager');
        if (!box) return;
        var cur = state.page || 1;
        var total = state.totalPages || 1;
        if (total <= 1) { box.innerHTML = ''; return; }

        var pages = [1];
        for (var p = cur - 2; p <= cur + 2; p++) {
            if (p > 1 && p < total && pages.indexOf(p) < 0) pages.push(p);
        }
        if (total > 1 && pages.indexOf(total) < 0) pages.push(total);
        pages.sort(function (a, b) { return a - b; });

        function btn(page, label, active, disabled) {
            var cls = active
                ? 'px-3 py-1 text-sm rounded bg-pink-600 text-white'
                : (disabled ? 'px-3 py-1 text-sm rounded bg-[#1a1a1a] text-gray-600'
                            : 'px-3 py-1 text-sm rounded bg-[#1a1a1a] text-gray-300');
            return '<button class="' + cls + ' mx-1 my-1" data-page="' + page + '"' +
                (disabled ? ' disabled' : '') + '>' + label + '</button>';
        }

        var html = btn(cur - 1, '上一页', false, cur <= 1);
        var prev = 0;
        for (var i = 0; i < pages.length; i++) {
            var pg = pages[i];
            if (prev && pg - prev > 1) html += '<span class="px-2 text-gray-500">…</span>';
            html += btn(pg, String(pg), pg === cur, false);
            prev = pg;
        }
        html += btn(cur + 1, '下一页', false, cur >= total);
        box.innerHTML = html;

        var buttons = box.querySelectorAll('button[data-page]');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].addEventListener('click', function () {
                if (this.disabled) return;
                var target = parseInt(this.getAttribute('data-page'), 10);
                if (!target || target === state.page || state.loading) return;
                state.page = target;
                var results = el('browse-results');
                if (results) results.innerHTML = '';
                var area = el('browseArea');
                if (area) window.scrollTo(0, Math.max(0, area.offsetTop - 20));
                loadPage();
            });
        }
    }

    // 采集站基本不支持服务端按热度排序（实测 by/order/sort=hits 都被忽略），
    // 所以「最热」只能客户端排：多拉两页，按 vod_hits 降序后再切 24 条/页。
    function sortBuffer() {
        if (state.sort !== 'hot') return;
        state.buffer.sort(function (a, b) {
            var ha = Number(a.vod_hits) || 0;
            var hb = Number(b.vod_hits) || 0;
            return hb - ha;
        });
    }

    function updateSortButtons() {
        var latest = el('sort-latest');
        var hot = el('sort-hot');
        if (!latest || !hot) return;
        var on = 'px-3 py-1 text-sm rounded-full bg-white text-black';
        var off = 'px-3 py-1 text-sm rounded-full text-gray-300';
        latest.className = state.sort === 'hot' ? off : on;
        hot.className = state.sort === 'hot' ? on : off;
    }

    function selectSort(sort) {
        if (state.sort === sort || state.loading) return;
        state.sort = sort;
        state.page = 1;
        state.buffer = [];
        state.loadedPages = 0;
        state.atEnd = false;
        updateSortButtons();
        var results = el('browse-results');
        if (results) results.innerHTML = '';
        loadPage();
    }

    async function loadPage() {
        if (state.loading || !state.source) return;
        state.loading = true;
        setStatus('加载中…');
        try {
            var need = state.page * PER_PAGE;
            // 最热排序要有足够样本，首屏先拉 3 个源页
            if (state.sort === 'hot') need = Math.max(need, SOURCE_PAGE_SIZE * 3);

            // 缺多少条就并行补几个源页（不要串行：第 1 页要 24 条 = 2 个源页，
            // 串行会让首屏多等一整轮 RTT）
            if (state.buffer.length < need) {
                var pagesToFetch = Math.ceil((need - state.buffer.length) / SOURCE_PAGE_SIZE);
                var startPage = state.loadedPages + 1;
                var reqs = [];
                for (var i = 0; i < pagesToFetch; i++) {
                    reqs.push(fetchSourcePage(state.source, state.classId, startPage + i));
                }
                var results = await Promise.allSettled(reqs);
                var anyOk = false;
                for (var j = 0; j < results.length; j++) {
                    var r = results[j];
                    if (r.status !== 'fulfilled') continue;
                    anyOk = true;
                    var res = r.value;
                    if (!res.list.length) { state.atEnd = true; break; }
                    state.buffer = state.buffer.concat(res.list);
                    state.loadedPages = startPage + j;
                    state.total = res.total;
                    if (res.list.length < SOURCE_PAGE_SIZE) { state.atEnd = true; break; }
                }
                if (!anyOk) throw new Error('源站无响应');
                var byTotal = state.total ? Math.ceil(state.total / PER_PAGE) : 0;
                var byLoaded = Math.ceil(state.buffer.length / PER_PAGE);
                if (state.sort === 'hot') {
                    // 最热只对已拉取的样本排序，页数也只能按样本算，
                    // 否则会显示几千页但翻过去全是空
                    state.totalPages = Math.max(1, byLoaded);
                } else {
                    state.totalPages = Math.max(byTotal, byLoaded, 1);
                }
            }

            sortBuffer();

            var startIdx = (state.page - 1) * PER_PAGE;
            var slice = state.buffer.slice(startIdx, startIdx + PER_PAGE);
            if (!slice.length) {
                setStatus('这一页没有内容');
            } else {
                renderVideos(slice, false);
                setStatus('');
            }
            renderPager();
        } catch (e) {
            renderPager();
            // ⚠️ 必须先放开 loading，否则下面的 loadPage()/selectSource() 会被
            // 它们各自开头的 `if (state.loading) return` 直接挡掉，回退静默失效。
            state.loading = false;
            if (state.classId !== null && !state.fallbackTried) {
                state.fallbackTried = true;
                state.classId = null;
                state.page = 1;
                state.buffer = [];
                state.loadedPages = 0;
                state.atEnd = false;
                renderClasses();
                setStatus('该分类暂不可用，已切回「最新」');
                loadPage();
                return;
            }
            setStatus('加载失败：' + (e && e.message ? e.message : e));
            if (fallbackSource()) return;
        } finally {
            state.loading = false;
        }
    }

    var triedSources = {};

    function fallbackSource() {
        for (var i = 0; i < state.sources.length; i++) {
            var k = state.sources[i].key;
            if (!triedSources[k]) {
                triedSources[k] = 1;
                selectSource(k);
                return true;
            }
        }
        return false;
    }

    async function selectSource(key) {
        if (state.loading) return;
        triedSources[key] = 1;
        state.source = key;
        state.page = 1;
        state.fallbackTried = false;
        state.buffer = [];
        state.loadedPages = 0;
        state.atEnd = false;
        state.classId = null;
        state.classes = [];
        renderSources();
        var box = el('browse-classes');
        if (box) box.innerHTML = '<span class="text-sm text-gray-500">加载分类…</span>';
        var results = el('browse-results');
        if (results) results.innerHTML = '';
        try {
            var classes = await fetchClasses(key);
            if (state.source !== key) return;
            state.classes = classes;
            renderClasses();
            if (classes.length) await selectClass(classes[0].type_id === null ? 'latest' : classes[0].type_id);
            else setStatus('该源不支持分类浏览');
        } catch (e) {
            if (state.source !== key) return;
            state.classes = [];
            renderClasses();
            setStatus('分类加载失败：' + (e && e.message ? e.message : e));
            fallbackSource();
        }
    }

    async function selectClass(classKey) {
        var classId = (classKey === 'latest' || classKey === null) ? null : classKey;
        state.classId = classId;
        state.page = 1;
        state.fallbackTried = false;
        state.buffer = [];
        state.loadedPages = 0;
        state.atEnd = false;
        var found = state.classes.filter(function (c) {
            return (classId === null) ? (c.type_id === null || c.type_id === undefined)
                : String(c.type_id) === String(classId);
        })[0];
        state.className = found ? found.type_name : '';
        renderClasses();
        var results = el('browse-results');
        if (results) results.innerHTML = '';
        await loadPage();
    }

    var initialized = false;

    async function init() {
        var area = el('browseArea');
        if (!area) return;

        // 源清单是异步从 /api/sources 拉的，必须等它就绪，
        // 否则 API_SITES 还是空的，selectedAPIs 全部过滤掉 → 一个源都没有
        if (window.__sourcesReady && typeof window.__sourcesReady.then === 'function') {
            try { await window.__sourcesReady; } catch (e) { /* 拉取失败就用现有清单 */ }
        }

        var keys = (typeof selectedAPIs !== 'undefined' && Array.isArray(selectedAPIs) && selectedAPIs.length)
            ? selectedAPIs.slice()
            : (window.DEFAULT_SELECTED_APIS || []).slice();

        state.sources = keys.map(function (k) { return { key: k, name: nameFor(k) }; })
            .filter(function (s) { return !!apiFor(s.key); });

        if (!state.sources.length) {
            setStatus('请先在设置里选择数据源');
            area.classList.remove('hidden');
            return;
        }

        if (initialized) {
            // 源更新后重入：只重画源标签，当前源还在就保留
            renderSources();
            if (!state.source || !apiFor(state.source)) selectSource(state.sources[0].key);
            return;
        }
        initialized = true;

        renderSources();
        updateSortButtons();
        var sortLatestBtn = el('sort-latest');
        var sortHotBtn = el('sort-hot');
        if (sortLatestBtn) sortLatestBtn.addEventListener('click', function () { selectSort('latest'); });
        if (sortHotBtn) sortHotBtn.addEventListener('click', function () { selectSort('hot'); });
        renderPager();

        area.classList.remove('hidden');
        // 旧 WebKit：容器在 hidden 状态下宽度为 0，legacy-aspect 算不出高度，
        // 显示后必须重算一次，否则海报要等图片加载完才撑开（页面「下沉」）。
        if (window.__legacyAspectFix) setTimeout(window.__legacyAspectFix, 0);
        selectSource(state.sources[0].key);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 订阅源到达后（或屏蔽成人源切换后）重新对齐源标签
    window.addEventListener('sources-updated', function () { init(); });
})();
