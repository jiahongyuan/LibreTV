/**
 * 启动后从服务端拉取最新订阅源，替换内置清单
 * ------------------------------------------------------------------
 * - 服务端 /api/sources 负责取订阅（Base58 → JSON）、解析并缓存（默认 2 小时）
 * - 拉不到时服务端回落到仓库里的 data/sources.json；客户端则继续用内置清单
 * - 订阅是唯一来源：拿到后整表替换，不再保留旧的内置源
 * - 暴露 window.__sourcesReady（Promise）和 sources-updated 事件：
 *   分类浏览等模块必须等源就绪再初始化，否则读到的是空的 API_SITES
 */
(function () {
    function isAdultBlocked() {
        return localStorage.getItem('blockAdultSources') === 'true';
    }

    // 「屏蔽成人源」：直接从 API_SITES 删掉成人条目，搜索/分类都不再出现
    function applyAdultBlock() {
        if (typeof API_SITES === 'undefined') return;
        if (!isAdultBlocked()) return;
        Object.keys(API_SITES).forEach(function (k) {
            if (API_SITES[k] && API_SITES[k].adult) delete API_SITES[k];
        });
        try {
            if (Array.isArray(selectedAPIs)) {
                selectedAPIs = selectedAPIs.filter(function (id) {
                    return String(id).indexOf('custom_') === 0 || API_SITES[id];
                });
                localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
            }
        } catch (e) { /* player.html 里是 const，忽略 */ }
    }

    window.__applyAdultBlock = applyAdultBlock;

    window.__sourcesReady = (async function refreshSourcesFromServer() {
        if (typeof API_SITES === 'undefined' || typeof window.extendAPISites !== 'function') {
            return; // config.js / customer_site.js 没加载成功
        }

        let data;
        try {
            const resp = await fetch('/api/sources', { cache: 'no-store' });
            if (!resp.ok) return;
            data = await resp.json();
        } catch (err) {
            console.warn('[sources] 拉取源列表失败，继续使用内置清单:', err && err.message);
            return;
        }
        if (!data || data.ok !== true || !data.sources) return;

        const incoming = data.sources;
        const count = Object.keys(incoming).length;
        if (count === 0) return;

        // 整表替换（连 config.js 里的占位源 testSource 一起清掉）
        Object.keys(API_SITES).forEach(function (k) { delete API_SITES[k]; });
        window.extendAPISites(incoming);

        // 屏蔽成人源（若开启）
        applyAdultBlock();

        // 清掉已不存在的勾选项；剩下的太少（订阅换了一批 key）就补齐默认
        try {
            if (Array.isArray(selectedAPIs)) {
                const valid = selectedAPIs.filter(function (id) {
                    return String(id).indexOf('custom_') === 0 || API_SITES[id];
                });
                if (valid.length !== selectedAPIs.length || valid.length < 4) {
                    const target = Math.max(8, valid.length);
                    const pool = Object.keys(API_SITES).filter(function (k) { return !API_SITES[k].adult; });
                    const filled = valid.slice();
                    for (let i = 0; i < pool.length && filled.length < target; i++) {
                        if (filled.indexOf(pool[i]) < 0) filled.push(pool[i]);
                    }
                    selectedAPIs = filled;
                    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
                }
            }
        } catch (err) {
            // player.html 里 selectedAPIs 是 const，改不动也不影响：那里只用来读源名
            console.warn('[sources] 调整勾选项失败（可忽略）:', err && err.message);
        }

        // 设置面板已经渲染过就重画一次
        if (typeof initAPICheckboxes === 'function' && document.getElementById('apiCheckboxes')) {
            initAPICheckboxes();
            if (typeof updateSelectedApiCount === 'function') updateSelectedApiCount();
        }

        try {
            window.dispatchEvent(new CustomEvent('sources-updated', {
                detail: { count: Object.keys(API_SITES).length, origin: data.origin }
            }));
        } catch (e) { /* 老浏览器没有 CustomEvent 构造器，忽略 */ }

        console.log('[sources] 已更新 ' + count + ' 个源（' + data.origin + (data.updatedAt ? ' @ ' + data.updatedAt : '') + '）');
    })();
})();
