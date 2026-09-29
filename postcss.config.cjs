/**
 * PostCSS 配置
 *
 * - autoprefixer：按 .browserslistrc 自动补 `-webkit-` 前缀
 *   （例如 backdrop-filter），并移除目标浏览器不需要的前缀。
 * - postcss-preset-env：为将来新增的现代 CSS 语法提供自动降级兜底。
 *   刻意关闭 `custom-properties` 转换——Safari 13.1 原生支持 CSS 变量，
 *   转换反而会破坏主题变量。
 *
 * 导出为工厂函数（PostCSS 的标准配置形式），
 * 既能被 postcss-load-config 识别，也能被 scripts/build.mjs 直接复用，
 * 保证构建脚本与外部工具使用完全一致的插件链。
 */
module.exports = () => ({
  plugins: [
    require('postcss-preset-env')({
      stage: 3,
      features: {
        'custom-properties': false,
        'nesting-rules': true,
      },
      // 交给下面的 autoprefixer 插件统一处理前缀
      autoprefixer: false,
    }),
    require('autoprefixer')({
      // 不生成 grid 的旧写法，Safari 13.1 已支持标准 grid
      grid: false,
    }),
  ],
});
