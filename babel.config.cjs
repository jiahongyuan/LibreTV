/**
 * Babel 配置 —— 面向 iOS 13.1 / Safari 13.1 的语法降级
 *
 * 说明：
 * - Safari 13.1 已原生支持可选链 `?.` 与空值合并 `??`，
 *   但为覆盖 class fields、逻辑赋值等较新语法，仍然统一走 preset-env 转译。
 * - `modules: false` 保留 ESM，避免破坏 index.html / player.html 的
 *   script 标签加载顺序（这些文件是按需引入的普通脚本）。
 */
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        // 与 .browserslistrc 保持一致，这里显式声明以保证构建可复现
        targets: {
          safari: '13.1',
          ios: '13.1',
        },
        modules: false,
        bugfixes: true,
        // 不注入 core-js polyfill：目标浏览器已具备所需内置 API，
        // 注入会显著增大产物体积。
        useBuiltIns: false,
      },
    ],
  ],
  comments: true,
  compact: false,
};
