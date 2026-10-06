#!/bin/sh
# LibreTV IP 证书续期（shortlived profile，6 天有效期 → 每天跑两次）
# 挑战文件由 libretv-tls 容器的 :80 提供（webroot），所以不需要占用 80 端口。
# 续期后 libretv-tls 会自己按 mtime 热加载证书，无需重启。
set -u
LOG=/var/log/libretv-cert-renew.log
mkdir -p /var/www/acme
{
  echo "=== $(date -u +%FT%TZ) 开始续期 ==="
  docker run --rm \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v /var/www/acme:/var/www/acme \
    certbot/certbot renew --webroot -w /var/www/acme --non-interactive
  rc=$?
  echo "=== $(date -u +%FT%TZ) 结束 rc=$rc ==="
} >> "$LOG" 2>&1
exit 0
