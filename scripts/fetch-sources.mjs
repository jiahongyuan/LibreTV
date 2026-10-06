/**
 * 从订阅生成内置源清单
 * ------------------------------------------------------------------
 * 产出：
 *   js/customer_site.js   内置源（同步加载，页面一打开就可用）
 *   data/sources.json     服务端 /api/sources 拉不到订阅时的兜底
 *
 * 用法：npm run sources        （可用 SUBSCRIPTION_URL=... 覆盖订阅地址）
 * 产物要提交进仓库；线上实时刷新由服务端 /api/sources 负责（见 server.mjs）。
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeSubscription } from './lib/sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL ||
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.txt';

// 默认勾选的源数量（取订阅前 N 个）
const DEFAULT_PICK = Number(process.env.DEFAULT_PICK || 6);

async function main() {
  console.log(`[sources] 拉取订阅：${SUBSCRIPTION_URL}`);
  const resp = await fetch(SUBSCRIPTION_URL, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`订阅请求失败：HTTP ${resp.status}`);
  const raw = await resp.text();
  console.log(`[sources] 收到 ${raw.trim().length} 字符，解析中…`);

  const { sources, order, cacheTime, updatedAt } = normalizeSubscription(raw);
  const defaults = order.slice(0, Math.min(DEFAULT_PICK, order.length));

  // ---- js/customer_site.js ----
  const lines = [
    '// ⚠️ 本文件由 scripts/fetch-sources.mjs 自动生成，请勿手工修改。',
    '// 重新生成：npm run sources',
    `// 订阅来源：${SUBSCRIPTION_URL}`,
    `// 生成时间：${updatedAt}（共 ${order.length} 个源）`,
    '',
    'const CUSTOMER_SITES = {',
  ];
  for (const key of order) {
    lines.push(`    ${key}: {`);
    lines.push(`        api: ${JSON.stringify(sources[key].api)},`);
    lines.push(`        name: ${JSON.stringify(sources[key].name)},`);
    lines.push('    },');
  }
  lines.push('};', '');
  lines.push('// 默认勾选的源（订阅前若干个）');
  lines.push(`window.DEFAULT_SELECTED_APIS = ${JSON.stringify(defaults)};`, '');
  lines.push('// 调用全局方法合并');
  lines.push('if (window.extendAPISites) {');
  lines.push('    window.extendAPISites(CUSTOMER_SITES);');
  lines.push('} else {');
  lines.push('    console.error("错误：请先加载 config.js！");');
  lines.push('}', '');
  await fs.writeFile(path.join(ROOT, 'js', 'customer_site.js'), lines.join('\n'), 'utf8');

  // ---- data/sources.json（服务端兜底） ----
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, 'data', 'sources.json'),
    JSON.stringify({ updatedAt, subscription: SUBSCRIPTION_URL, cacheTime, count: order.length, sources }, null, 2) + '\n',
    'utf8'
  );

  console.log(`[sources] 完成：${order.length} 个源 → js/customer_site.js、data/sources.json`);
  console.log(`[sources] 默认勾选：${defaults.join(', ')}`);
}

main().catch((err) => {
  console.error('[sources] 失败：', err.message);
  process.exit(1);
});
