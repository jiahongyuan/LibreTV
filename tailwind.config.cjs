/** @type {import('tailwindcss').Config} */
/**
 * Tailwind 配置
 *
 * 目标：替换原来的 Play CDN 运行时编译，改为构建期扫描 + 预编译。
 * content 必须同时覆盖 HTML 与 JS —— 大量 class 是通过
 * `className = '...'` / 模板字符串在 JS 中动态写入 DOM 的。
 *
 * 注意：项目中的动态 class 都是完整字面量（例如 'text-pink-400'），
 * 不存在 `bg-${color}-500` 这类拼接，因此无需 safelist。
 */
module.exports = {
  content: [
    './index.html',
    './player.html',
    './about.html',
    './watch.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {},
  },
  // 与 CDN 默认行为保持一致，保留 preflight（基础样式重置）
  corePlugins: {
    preflight: true,
  },
};
