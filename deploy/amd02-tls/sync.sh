#!/bin/bash
# 把仓库里的 TLS 前置层单向同步到 amd02 并重建。
# 仓库是唯一来源；服务器上不保留任何「权威副本」——本脚本可随时把一切重建出来。
set -euo pipefail

HOST="${HOST:-amd02}"
REMOTE_DIR="${REMOTE_DIR:-/opt/libretv-tls}"
UNIT_DIR=/etc/systemd/system
RENEW_DST=/usr/local/sbin/libretv-cert-renew.sh

cd "$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/5 同步构建上下文 → $HOST:$REMOTE_DIR"
ssh "$HOST" "sudo -n mkdir -p $REMOTE_DIR /var/www/acme"
tar czf - terminator.mjs Dockerfile docker-compose.yml \
  | ssh "$HOST" "sudo -n tar xzf - -C $REMOTE_DIR"

echo "==> 2/5 安装续期脚本 → $RENEW_DST（不放在 $REMOTE_DIR，续期不依赖构建上下文）"
ssh "$HOST" "sudo -n tee $RENEW_DST >/dev/null && sudo -n chmod 0755 $RENEW_DST" < libretv-cert-renew.sh

echo "==> 3/5 安装 systemd 单元"
tar czf - libretv-cert-renew.service libretv-cert-renew.timer \
  | ssh "$HOST" "sudo -n tar xzf - -C $UNIT_DIR && sudo -n chmod 0644 $UNIT_DIR/libretv-cert-renew.service $UNIT_DIR/libretv-cert-renew.timer && sudo -n systemctl daemon-reload && sudo -n systemctl enable --now libretv-cert-renew.timer"

echo "==> 4/5 校验 md5（本地 vs 远端）"
fail=0
for f in terminator.mjs Dockerfile docker-compose.yml; do
  L=$(md5sum "$f" | cut -d' ' -f1)
  R=$(ssh "$HOST" "sudo -n md5sum $REMOTE_DIR/$f" | cut -d' ' -f1)
  if [ "$L" = "$R" ]; then echo "    OK   $f"; else echo "    DIFF $f"; fail=1; fi
done
L=$(md5sum libretv-cert-renew.sh | cut -d' ' -f1)
R=$(ssh "$HOST" "sudo -n md5sum $RENEW_DST" | cut -d' ' -f1)
if [ "$L" = "$R" ]; then echo "    OK   libretv-cert-renew.sh"; else echo "    DIFF libretv-cert-renew.sh"; fail=1; fi
[ "$fail" = 0 ] || { echo "md5 校验失败，已中止"; exit 1; }

echo "==> 5/5 重建并重启 libretv-tls"
ssh "$HOST" "cd $REMOTE_DIR && sudo -n docker compose build 2>&1 | tail -2 && sudo -n docker compose up -d 2>&1 | tail -3"
ssh "$HOST" "sudo -n docker ps --filter name=libretv-tls --format '{{.Names}} {{.Status}} {{.Ports}}'"
echo "==> 完成"
