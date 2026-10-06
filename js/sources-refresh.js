/**
 * 启动后从服务端拉取最新订阅源，替换内置清单
 * ------------------------------------------------------------------
 * - 服务端 /api/sources 负责取订阅（Base58 → JSON）、解析并缓存（默认 2 小时）
 * - 拉不到时服务端回落到仓库里的 data/sources.json；客户端则继续用内置清单
 * - 订阅是唯一来源：拿到后整表替换，不再保留旧的内置源
 */
(async function refreshSourcesFromServer() {
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

    // 清掉已不存在的勾选项；若全被清空则套用默认
    try {
        if (Array.isArray(selectedAPIs)) {
            const valid = selectedAPIs.filter(function (id) {
                return String(id).indexOf('custom_') === 0 || API_SITES[id];
            });
            if (valid.length !== selectedAPIs.length) {
                selectedAPIs = valid.length > 0 ? valid : (window.DEFAULT_SELECTED_APIS || []).slice();
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

    console.log('[sources] 已更新 ' + count + ' 个源（' + data.origin + (data.updatedAt ? ' @ ' + data.updatedAt : '') + '）');
})();
