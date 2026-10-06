# 自动部署（push → Cloudflare Pages）

在 arm-phoenix 上由 systemd 用户 timer 每 5 分钟轮询一次 `origin/main`，有新提交就自动构建并发布到
Cloudflare Pages 项目 `steve-libretv`。

## 为什么不是 GitHub Actions / Pages 的 Git 集成

- Pages 的 Git 集成需要把 Cloudflare GitHub App 装到仓库上（要人工在浏览器里授权）；
  而且**直接上传类型的项目不能改成 Git 集成**，只能新建项目。
- GitHub Actions 需要在仓库里配 `CLOUDFLARE_API_TOKEN` 等 secrets，而这台机器上只有 GitHub 的 **SSH** 凭据，
  没有可写 secrets 的 API token。
- 轮询方案只用现有凭据（SSH + `~/.cloudflare/env`），零授权步骤，且不把 CF token 放到 GitHub 上。

## 文件

| 位置 | 作用 |
|---|---|
| `deploy/autodeploy/libretv-autodeploy.sh` | 部署脚本本体（安装到 `~/libretv-autodeploy.sh`） |
| `deploy/autodeploy/libretv-autodeploy.{service,timer}` | systemd 用户单元（安装到 `~/.config/systemd/user/`） |
| `~/.cloudflare/env`（600） | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，脚本启动时 source |
| `~/.libretv-autodeploy.log` | 运行日志 |

## 行为

1. 工作区有未提交改动 → **跳过**（绝不覆盖人工修改）。
2. `git fetch origin main`，与本地 HEAD 相同 → 静默退出（不留日志）。
3. 有新提交 → `git merge --ff-only` → （仅当 `package*.json` 变化时 `npm ci`）→ `npm run build`
   → `npx wrangler pages deploy dist --project-name=steve-libretv`。
4. 任一步失败都会写进日志并退出（不会留下半成品部署）。

## 安装 / 重装

```bash
cp deploy/autodeploy/libretv-autodeploy.sh ~/libretv-autodeploy.sh && chmod +x ~/libretv-autodeploy.sh
cp deploy/autodeploy/libretv-autodeploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now libretv-autodeploy.timer
```

## 排障

```bash
systemctl --user list-timers libretv-autodeploy.timer   # 下次触发时间
systemctl --user start libretv-autodeploy.service       # 立刻跑一次
tail -f ~/.libretv-autodeploy.log                       # 看日志
```

注意：用户级 timer 依赖 `loginctl enable-linger steve`（本机已开启）。
