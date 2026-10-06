#!/bin/bash
# LibreTV 自动部署：跟踪 GitHub 的 main，有新提交就构建并发布到 Cloudflare Pages
# 由 systemd 用户 timer（libretv-autodeploy.timer，每 5 分钟）调用
set -uo pipefail

REPO=/home/steve/LibreTV
LOG=/home/steve/.libretv-autodeploy.log
PROJ=${PAGES_PROJECT:-steve-libretv}
export PATH=/home/steve/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

if [ -f /home/steve/.cloudflare/env ]; then
  # set -a：把 source 进来的变量自动 export，否则子进程（npx wrangler）看不到
  set -a
  # shellcheck disable=SC1091
  . /home/steve/.cloudflare/env
  set +a
fi

log() { echo "[$(date -u +%FT%TZ)] $*" >>"$LOG"; }

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { log "!! 缺少 CLOUDFLARE_API_TOKEN（见 ~/.cloudflare/env）"; exit 1; }
[ -d "$REPO/.git" ] || { log "!! 仓库不存在：$REPO"; exit 1; }

cd "$REPO" || exit 1

# 工作区有未提交改动就跳过 —— 绝不覆盖人工修改
if [ -n "$(git status --porcelain)" ]; then
  log "跳过：工作区有未提交改动"
  exit 0
fi

git fetch --quiet origin main || { log "!! git fetch 失败（网络或 SSH 凭据）"; exit 1; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # 无更新，保持安静

log "发现新提交：$(git log --oneline -1 "$REMOTE")"
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")

git merge --ff-only origin/main >>"$LOG" 2>&1 || { log "!! 快进合并失败，需人工处理"; exit 1; }

if echo "$CHANGED" | grep -qE '^package(-lock)?\.json$'; then
  log "依赖有变化 → npm ci"
  npm ci >>"$LOG" 2>&1 || { log "!! npm ci 失败"; exit 1; }
fi

log "构建中…"
npm run build >>"$LOG" 2>&1 || { log "!! 构建失败"; exit 1; }

log "发布到 Cloudflare Pages（项目 $PROJ）…"
npx --yes wrangler@latest pages deploy dist --project-name="$PROJ" --commit-dirty=true >>"$LOG" 2>&1 \
  || { log "!! 发布失败"; exit 1; }

log "已发布：$(git log --oneline -1)"
