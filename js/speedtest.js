/**
 * 数据源测速
 * ------------------------------------------------------------------
 * 对当前勾选的内置源各发一次真实搜索请求（走服务端 /proxy，与正常搜索同一条链路），
 * 统计「耗时 + 返回条数」，把可用的按速度排好序，并支持一键只保留最快的几个。
 */

const SPEEDTEST_KEYWORD = '爱情';
const SPEEDTEST_CONCURRENCY = 4;
const SPEEDTEST_TIMEOUT_MS = 12000;
const SPEEDTEST_KEEP_FASTEST = 5;

let speedTestOkResults = [];

function speedTestTargets() {
    const list = (typeof selectedAPIs !== 'undefined' && Array.isArray(selectedAPIs)) ? selectedAPIs : [];
    return list.filter(function (id) {
        return String(id).indexOf('custom_') !== 0 && API_SITES[id];
    });
}

async function speedTestOneSource(key) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, SPEEDTEST_TIMEOUT_MS);
    const started = performance.now();
    try {
        const resp = await fetch(
            '/api/search?wd=' + encodeURIComponent(SPEEDTEST_KEYWORD) + '&source=' + encodeURIComponent(key),
            { signal: controller.signal, cache: 'no-store' }
        );
        const ms = Math.round(performance.now() - started);
        if (!resp.ok) {
            return { key: key, ms: ms, count: 0, ok: false, note: 'HTTP ' + resp.status };
        }
        const data = await resp.json();
        const count = data && Array.isArray(data.list) ? data.list.length : 0;
        return { key: key, ms: ms, count: count, ok: count > 0, note: count > 0 ? '' : '无结果' };
    } catch (err) {
        return {
            key: key,
            ms: Math.round(performance.now() - started),
            count: 0,
            ok: false,
            note: err && err.name === 'AbortError' ? '超时' : '失败'
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function speedTestSources() {
    const box = document.getElementById('speedTestResults');
    if (!box) return;
    box.classList.remove('hidden');

    const targets = speedTestTargets();
    if (targets.length === 0) {
        box.innerHTML = '<div class="text-xs text-red-400 py-1">请先勾选至少一个内置源</div>';
        return;
    }

    box.innerHTML = '<div id="speedTestStatus" class="text-xs text-gray-400 py-1">测速中… 0/' + targets.length + '</div>';
    const statusEl = document.getElementById('speedTestStatus');
    const results = [];
    let cursor = 0;
    let finished = 0;

    async function worker() {
        while (cursor < targets.length) {
            const key = targets[cursor++];
            const result = await speedTestOneSource(key);
            results.push(result);
            finished++;
            if (statusEl) statusEl.textContent = '测速中… ' + finished + '/' + targets.length;
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(SPEEDTEST_CONCURRENCY, targets.length); i++) workers.push(worker());
    await Promise.all(workers);

    speedTestOkResults = results.filter(function (r) { return r.ok; }).sort(function (a, b) { return a.ms - b.ms; });
    renderSpeedTestResults(results);
}

function renderSpeedTestResults(results) {
    const box = document.getElementById('speedTestResults');
    if (!box) return;

    const ok = results.filter(function (r) { return r.ok; }).sort(function (a, b) { return a.ms - b.ms; });
    const bad = results.filter(function (r) { return !r.ok; }).sort(function (a, b) { return a.ms - b.ms; });

    const rows = ok.concat(bad).map(function (r) {
        const name = API_SITES[r.key] ? API_SITES[r.key].name : r.key;
        const right = r.ok
            ? (r.ms + ' ms · ' + r.count + ' 条')
            : (r.note || '失败') + ' · ' + r.ms + ' ms';
        const cls = !r.ok ? 'text-red-400'
            : (r.ms < 800 ? 'text-green-400' : (r.ms < 2000 ? 'text-amber-400' : 'text-gray-400'));
        return '<div class="flex items-center justify-between py-0.5">' +
            '<span class="truncate text-gray-300">' + escapeHtml(name) + '</span>' +
            '<span class="ml-2 whitespace-nowrap ' + cls + '">' + escapeHtml(right) + '</span>' +
            '</div>';
    }).join('');

    box.innerHTML =
        '<div class="text-xs text-gray-400 mb-1">测速结果（关键词「' + escapeHtml(SPEEDTEST_KEYWORD) + '」）：可用 ' +
        ok.length + '/' + results.length + '</div>' +
        '<div class="max-h-40 overflow-y-auto">' + rows + '</div>' +
        '<div class="flex space-x-2 mt-2">' +
        '<button onclick="applyFastestSources(' + SPEEDTEST_KEEP_FASTEST + ')" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded">只保留最快 ' + SPEEDTEST_KEEP_FASTEST + ' 个</button>' +
        '<button onclick="document.getElementById(\'speedTestResults\').classList.add(\'hidden\')" class="px-2 py-1 bg-[#333] hover:bg-[#444] text-white text-xs rounded">收起</button>' +
        '</div>';
}

function applyFastestSources(n) {
    if (!speedTestOkResults || speedTestOkResults.length === 0) {
        showToast('还没有可用的测速结果', 'error');
        return;
    }
    const picked = speedTestOkResults.slice(0, n).map(function (r) { return r.key; });
    selectedAPIs = picked;
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    initAPICheckboxes();
    updateSelectedApiCount();
    showToast('已选中最快的 ' + picked.length + ' 个源', 'success');
}
