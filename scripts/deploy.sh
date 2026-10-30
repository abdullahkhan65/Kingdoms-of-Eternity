#!/usr/bin/env bash
# Deploy the working tree to the game server VM and restart the service.
#   ./scripts/deploy.sh            (defaults below; override with KOE_HOST / KOE_KEY)
set -euo pipefail
HOST="${KOE_HOST:-ubuntu@89.168.127.10}"
KEY="${KOE_KEY:-$HOME/.ssh/oracle_koe}"
SSH=(ssh -i "$KEY" "$HOST")

cd "$(dirname "$0")/.."
rsync -az --delete -e "ssh -i $KEY" --exclude node_modules --exclude .git --exclude dist --exclude smoke-out ./ "$HOST:~/koe/"
"${SSH[@]}" 'set -e
  cd ~/koe
  npm ci --no-audit --no-fund >/dev/null
  npm run build:client >/dev/null
  sudo cp deploy/koe.service /etc/systemd/system/koe.service
  sudo systemctl daemon-reload
  sudo systemctl enable koe >/dev/null 2>&1
  sudo systemctl restart koe
  sleep 3
  systemctl is-active koe
  journalctl -u koe -n 1 --no-pager -o cat'
echo "Live: http://${HOST#*@}:2567"
