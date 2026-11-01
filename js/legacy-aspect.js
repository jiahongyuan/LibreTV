/**
 * iOS 13.1 / Safari 13.1 的 aspect-ratio 兜底
 * =================================================================
 * Safari 15 才支持 CSS aspect-ratio。旧 WebKit 会整条忽略
 * `.aspect-[2/3]`，容器高度退化成「图片自身高度」，导致豆瓣海报 /
 * 推荐海报高度参差（实测 191~229px 不等）。
 *
 * ⚠️ 不要用 padding-top:150% 之类的 CSS 比例盒降级：
 *    旧 WebKit 计算 grid 行固有尺寸时会把它当 0 高，实测出现过
 *    「栅格塌陷 / 页脚被插进列表中间 / 卡片高度翻倍」三种事故。
 *
 * 这里改成「JS 给容器写显式像素高度」：
 *   - 高度是显式的，不参与固有尺寸推导，不会影响 grid 行高；
 *   - 图片的 h-full / object-cover 因为父容器有确定高度而正常生效；
 *   - 旋转屏幕 / 窗口尺寸变化时重算，动态渲染的内容由 MutationObserver 补。
 * 新引擎（支持 aspect-ratio）直接 return，不产生任何副作用。
 */
(function () {
    'use strict';

    if (!window.CSS || !window.CSS.supports) return;
    if (window.CSS.supports('aspect-ratio', '2 / 3')) return;

    var SELECTOR = '.aspect-\\[2\\/3\\]';
    var RATIO = 3 / 2;

    function apply(el) {
        var width = el.clientWidth;
        if (!width) return;
        var target = Math.round(width * RATIO);
        var current = el.getAttribute('data-legacy-h');
        if (current === String(target)) return;
        el.style.height = target + 'px';
        el.setAttribute('data-legacy-h', String(target));
    }

    function fixAll() {
        var els = document.querySelectorAll(SELECTOR);
        for (var i = 0; i < els.length; i++) {
            apply(els[i]);
        }
    }

    var pending = null;
    function schedule() {
        if (pending) clearTimeout(pending);
        pending = setTimeout(fixAll, 60);
    }

    function onReady() {
        fixAll();
        if (window.MutationObserver) {
            var mo = new MutationObserver(schedule);
            mo.observe(document.body, { childList: true, subtree: true });
        }
        window.addEventListener('resize', function () {
            // 宽度变了才需要重算，清掉缓存标记
            var els = document.querySelectorAll(SELECTOR);
            for (var i = 0; i < els.length; i++) {
                els[i].removeAttribute('data-legacy-h');
            }
            schedule();
        });
        window.addEventListener('orientationchange', schedule);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    window.__legacyAspectFix = fixAll;
})();
