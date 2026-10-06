# amd02 TLS 前置层（LibreTV）

线上入口 `https://161.153.9.187/` 的 TLS 终结层，部署在 amd02（`161.153.9.187`）。

| 文件 | 作用 |
|---|---|
| `terminator.mjs` | :80 提供 ACME http-01 挑战文件 + 301 跳转；:443 TLS 终结并反代到 `libretv:8080`；每 5 分钟按 mtime 热加载证书 |
| `Dockerfile` | `node:lts-alpine` 单文件镜像 |
| `docker-compose.yml` | 容器 `libretv-tls`，发布 80/443，加入外部网络 `libretv_default` |
| `libretv-cert-renew.sh` | certbot（容器）webroot 续期，日志 `/var/log/libretv-cert-renew.log`；由 `sync.sh` 安装到 `/usr/local/sbin/libretv-cert-renew.sh` |
| `libretv-cert-renew.{service,timer}` | systemd 定时器，每天 03/17 点跑一次续期 |
| `sync.sh` | 单向同步：仓库 → amd02（含 md5 校验、装单元、重建容器） |

## 仓库是唯一来源

服务器上**不保留源码副本**：`/opt/libretv-tls` 只是本脚本生成的构建上下文，随时可以删掉/重建；
续期脚本装在 `/usr/local/sbin/libretv-cert-renew.sh`（续期不依赖构建上下文）。
改动流程固定为：**改仓库 → `./sync.sh`**。

恢复（例如服务器上目录被误删、镜像被 prune）：

```bash
cd deploy/amd02-tls && ./sync.sh
```


## 为什么是容器而不是 nginx/caddy

主机 iptables 的 INPUT 链默认 `REJECT`（只放行 22）。Docker 发布的端口走 DNAT，绕过 INPUT；
主机进程监听 80/443 会直接被 REJECT。OCI 安全组本身对 80/443 是放开的。

## 证书

Let's Encrypt **IP 证书**，cert 名 `libretv-ip`，`--preferred-profile shortlived`，**6 天**有效期。

```bash
# 签发（注意是 --ip-address，用 -d 会报 "will not issue certificates for a bare IP address"）
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  certbot/certbot certonly --standalone --non-interactive --agree-tos \
  --cert-name libretv-ip --preferred-profile shortlived --key-type ecdsa \
  --ip-address 161.153.9.187
```

ACME 账号复用 arm-phoenix 的（`/etc/letsencrypt/accounts` 拷过来），所以不需要再填邮箱。

## 部署 / 同步到 amd02

```bash
cd deploy/amd02-tls && ./sync.sh          # HOST=amd02 REMOTE_DIR=/opt/libretv-tls
```

脚本做的事：同步构建上下文 → 装 `/usr/local/sbin/libretv-cert-renew.sh` → 装 systemd 单元并
`daemon-reload` + `enable --now` 定时器 → md5 逐个校验 → 重建并重启 `libretv-tls`。

改 `terminator.mjs` 后只需重跑 `sync.sh`，不影响 libretv 容器。

## 自测

```bash
# ACME 通路（不消耗 LE 限额）
ssh amd02 'echo ok | sudo -n tee /var/www/acme/probe-token'
curl http://161.153.9.187/.well-known/acme-challenge/probe-token   # 应回 ok
curl -o /dev/null -w '%{http_code}\n' "http://161.153.9.187/.well-known/acme-challenge/..%2F..%2Fetc%2Fpasswd"  # 应 400
# 证书与跳转
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://161.153.9.187/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://161.153.9.187/
```
