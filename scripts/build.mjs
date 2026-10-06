#!/usr/bin/env node
/**
 * 构建脚本 —— 生成面向 iOS 13.1 / Safari 13.1 的静态产物
 * =================================================================
 * 产物目录：dist/
 *
 * 处理流水线：
 *   1. CSS  → PostCSS（preset-env + autoprefixer），按 .browserslistrc 降级
 *      - src/tailwind.css 额外经过 Tailwind 编译（替代原 Play CDN 运行时编译）
 *   2. JS   → Babel，按 .browserslistrc 转译语法（兜底未来新增的现代语法）
 *   3. 静态资源 → 直接复制（libs/ 已人工核验：无 Safari 13.1 不支持的语法，
 *      因此不做转译，避免 minified 代码被改写而膨胀）
 *   4. 兼容性自检 → 扫描产物中残留的不兼容属性并给出报告
 *
 * 用法：node scripts/build.mjs
 * =================================================================
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import babel from '@babel/core';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** 需要复制到产物根目录的散装文件 */
const COPY_FILES = [
  'index.html',
  'player.html',
  'about.html',
  'watch.html',
  'manifest.json',
  'robots.txt',
  'VERSION.txt',
  'service-worker.js',
];

/** 需要整体复制的目录 */
const COPY_DIRS = ['libs', 'image'];

/** libs 中不再需要的文件（Play CDN 已被构建期编译取代） */
const COPY_EXCLUDE = new Set(['tailwindcss.min.js']);

const report = {
  css: [],
  js: [],
  copied: [],
  warnings: [],
};

// ---------------------------------------------------------------- 工具函数

const log = (msg) => console.log(`[build] ${msg}`);

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function copyDir(srcDir, destDir) {
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (COPY_EXCLUDE.has(entry.name)) {
      log(`跳过（已废弃）：${path.relative(ROOT, path.join(srcDir, entry.name))}`);
      continue;
    }
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dest);
    } else {
      await ensureDir(path.dirname(dest));
      await fsp.copyFile(src, dest);
      report.copied.push(dest);
    }
  }
}

async function readFileSize(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.size;
  } catch {
    return 0;
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------- CSS 阶段

/** 从 postcss.config.cjs 载入插件（保持单一配置来源） */
function loadCssPlugins() {
  const configFactory = require('../postcss.config.cjs');
  const config = typeof configFactory === 'function' ? configFactory({}) : configFactory;
  return config.plugins;
}

async function buildTailwindCss() {
  const src = path.join(ROOT, 'src/tailwind.css');
  const dest = path.join(DIST, 'css/tailwind.css');

  const css = await fsp.readFile(src, 'utf8');

  // content 里的 glob 统一转换为绝对路径，避免受工作目录影响
  const rawConfig = require('../tailwind.config.cjs');
  const twConfig = {
    ...rawConfig,
    content: rawConfig.content.map((p) => path.join(ROOT, p)),
  };

  const result = await postcss([tailwindcss(twConfig), ...loadCssPlugins()]).process(css, {
    from: src,
    to: dest,
  });

  await ensureDir(path.dirname(dest));
  await fsp.writeFile(dest, result.css);
  report.css.push({ file: dest, size: result.css.length });
  log(`Tailwind 编译完成：css/tailwind.css (${kb(result.css.length)})`);
}

async function buildPlainCss() {
  const srcDir = path.join(ROOT, 'css');
  const files = (await fsp.readdir(srcDir)).filter((f) => f.endsWith('.css'));

  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(DIST, 'css', file);
    const css = await fsp.readFile(src, 'utf8');

    const result = await postcss(loadCssPlugins()).process(css, { from: src, to: dest });
    await ensureDir(path.dirname(dest));
    await fsp.writeFile(dest, result.css);
    report.css.push({ file: dest, size: result.css.length });
  }
  log(`样式编译完成：${files.length} 个文件（css/*.css）`);
}

// ---------------------------------------------------------------- JS 阶段

async function buildJs() {
  const srcDir = path.join(ROOT, 'js');
  const destDir = path.join(DIST, 'js');
  const files = (await fsp.readdir(srcDir)).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);

    const result = await babel.transformFileAsync(src, {
      configFile: path.join(ROOT, 'babel.config.cjs'),
      babelrc: false,
      sourceMaps: false,
    });

    await ensureDir(destDir);
    await fsp.writeFile(dest, `${result.code}\n`);
    report.js.push({
      file: dest,
      before: await readFileSize(src),
      after: Buffer.byteLength(result.code, 'utf8'),
    });
  }
  log(`脚本转译完成：${files.length} 个文件（js/*.js → Safari 13.1 语法）`);
}

// ---------------------------------------------------------------- 复制阶段

async function copyStatic() {
  for (const file of COPY_FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) {
      report.warnings.push(`源文件不存在，已跳过：${file}`);
      continue;
    }
    await fsp.copyFile(src, path.join(DIST, file));
  }
  for (const dir of COPY_DIRS) {
    const src = path.join(ROOT, dir);
    if (fs.existsSync(src)) {
      await copyDir(src, path.join(DIST, dir));
    }
  }
  log(`静态资源复制完成：${COPY_FILES.length} 个文件 + ${COPY_DIRS.length} 个目录`);
}

// ---------------------------------------------------------------- 兼容自检

/**
 * 静态扫描产物，提示可能仍不被 Safari 13.1 支持的特性。
 * 只做「提示」，不阻断构建 —— 部分用法是刻意保留的（例如 @supports 探针）。
 */
async function selfCheck() {
  const cssFiles = [];
  const jsFiles = [];

  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (full.endsWith('.css')) cssFiles.push(full);
      else if (full.endsWith('.js')) jsFiles.push(full);
    }
  };
  await walk(DIST);

  // 若产物中存在对应的 @supports 兜底，则该项视为“已处理”
  const allCss = (await Promise.all(cssFiles.map((f) => fsp.readFile(f, 'utf8')))).join('\n');
  const covered = {
    'inset 简写': /@supports\s+not\s*\(\s*inset\s*:/.test(allCss),
    'aspect-ratio': /@supports\s+not\s*\(\s*aspect-ratio\s*:/.test(allCss),
  };

  const cssPatterns = [
    // 只匹配“作为属性名”的写法：排除 --tw-ring-inset 这类变量名
    // 以及 box-shadow 中的 `inset` 关键字
    { name: 'inset 简写', re: /(?:^|[;{]\s*)inset\s*:/gm },
    { name: 'aspect-ratio', re: /(?:^|[;{]\s*)aspect-ratio\s*:/gm },
    // :where()/:is() 自 Safari 14 起才有；旧 WebKit 会整条丢弃该规则
    { name: ':where() (Safari 14)', re: /:where\s*\(/g },
    { name: ':is() (Safari 14)', re: /:is\s*\(/g },
  ];
  const jsPatterns = [
    // ⚠️ AbortSignal.timeout() 自 Safari 16 起才有 —— 曾经漏检，
    // 导致 iOS 13.5 上调用即 TypeError。新增任何「按 Safari 版本才有的 API」都要加进来。
    { name: 'AbortSignal.timeout() (Safari 16)', re: /AbortSignal\s*\.\s*timeout/g },
    { name: 'crypto.randomUUID() (Safari 15.4)', re: /randomUUID/g },
    { name: 'Array.prototype.at()', re: /\.at\(\s*[-0-9]/g },
    { name: 'structuredClone()', re: /structuredClone\s*\(/g },
    { name: 'Object.hasOwn()', re: /Object\.hasOwn\s*\(/g },
    { name: '逻辑赋值 ??= / ||= / &&=', re: /(\?\?=|\|\|=|&&=)/g },
    { name: '私有字段 this.#field', re: /this\.#[a-zA-Z_]\w*/g },
    { name: 'static 初始化块', re: /static\s*\{/g },
  ];

  const hits = [];
  for (const [files, patterns, kind] of [
    [cssFiles, cssPatterns, 'CSS'],
    [jsFiles, jsPatterns, 'JS'],
  ]) {
    for (const file of files) {
      const content = await fsp.readFile(file, 'utf8');
      for (const { name, re } of patterns) {
        const matches = content.match(re);
        if (matches) {
          hits.push({
            kind,
            file: path.relative(DIST, file),
            name,
            count: matches.length,
            covered: covered[name] === true,
          });
        }
      }
    }
  }

  // backdrop-filter 需成对判断：
  // autoprefixer 会同时输出「带前缀」与「不带前缀」两份，
  // 因此只有在缺少配对的前缀版本时才视为异常。
  for (const file of cssFiles) {
    const content = await fsp.readFile(file, 'utf8');
    const plain = (content.match(/(?<!-webkit-)backdrop-filter\s*:/g) || []).length;
    const prefixed = (content.match(/-webkit-backdrop-filter\s*:/g) || []).length;
    if (plain > prefixed) {
      hits.push({
        kind: 'CSS',
        file: path.relative(DIST, file),
        name: '缺少 -webkit- 前缀的 backdrop-filter',
        count: plain - prefixed,
        covered: false,
      });
    }
  }

  return hits;
}

// ---------------------------------------------------------------- 产物校验

/**
 * 用 Node 的 vm 模块编译产物，确保 Babel 输出依旧是合法 JS。
 * 含 import/export 的模块文件跳过（vm.SourceTextModule 需要
 * --experimental-vm-modules 标志，而原样保留 ESM 本就是预期行为）。
 */
async function validateJsSyntax() {
  const dir = path.join(DIST, 'js');
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.js'));
  const errors = [];

  for (const file of files) {
    const content = await fsp.readFile(path.join(dir, file), 'utf8');
    if (/^\s*(import|export)\s/m.test(content)) continue;
    try {
      new vm.Script(content, { filename: file });
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const started = Date.now();
  log(`开始构建 → ${path.relative(ROOT, DIST)}/`);

  await fsp.rm(DIST, { recursive: true, force: true });
  await ensureDir(DIST);

  await buildTailwindCss();
  await buildPlainCss();
  await buildJs();
  await copyStatic();

  const hits = await selfCheck();
  const syntaxErrors = await validateJsSyntax();

  // ---- 报告 ----
  console.log('\n================ 构建报告 ================');
  console.log(`产物目录: dist/`);
  console.log(`耗时: ${Date.now() - started} ms`);

  const totalCss = report.css.reduce((sum, f) => sum + f.size, 0);
  console.log(`\n[CSS] ${report.css.length} 个文件，共 ${kb(totalCss)}`);
  console.log(`[JS ] ${report.js.length} 个文件`);
  const grew = report.js.filter((f) => f.after > f.before);
  console.log(`      其中体积增长: ${grew.length} 个（Babel 降级语法的正常代价）`);
  console.log(`[资源] 复制 ${report.copied.length} 个文件`);

  console.log('\n---- 兼容性自检（目标 Safari 13.1）----');
  if (hits.length === 0) {
    console.log('未发现可疑残留。');
  } else {
    const pending = hits.filter((h) => !h.covered);
    const handled = hits.filter((h) => h.covered);

    for (const hit of pending) {
      console.log(`⚠ [${hit.kind}] ${hit.file} → ${hit.name} × ${hit.count}（需人工确认）`);
    }
    for (const hit of handled) {
      console.log(
        `· [${hit.kind}] ${hit.file} → ${hit.name} × ${hit.count}（保留原始写法，已由 @supports 降级层覆盖）`
      );
    }
    if (pending.length === 0) {
      console.log('所有检出的不兼容特性均已由降级层覆盖。');
    }
  }

  if (report.warnings.length) {
    console.log('\n---- 警告 ----');
    report.warnings.forEach((w) => console.log(`⚠ ${w}`));
  }

  console.log('\n---- 语法校验（js 产物）----');
  if (syntaxErrors.length === 0) {
    console.log('全部脚本产物语法合法。');
  } else {
    syntaxErrors.forEach((e) => console.log(`⚠ ${e}`));
  }

  console.log('=========================================\n');
  log('构建完成 ✅');
}

main().catch((err) => {
  console.error('[build] 构建失败：', err);
  process.exit(1);
});
