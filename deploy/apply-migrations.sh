#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Применяет миграции базы (в том числе новые таблицы модуля сообщений)
# и перезапускает магазин.
#
# Запуск:  bash /root/apply-migrations.sh
# ---------------------------------------------------------------------------
set -euo pipefail
APP=/srv/narazborku/app/apps/backend

cd "$APP"
echo "=== миграции ==="
sudo -u medusa -H env NODE_ENV=production bash -lc "cd $APP && npx medusa db:migrate" 2>&1 | tail -12

echo
echo "=== таблицы сообщений в базе ==="
sudo -u postgres psql -d narazborku -c "\dt conversation" -c "\dt message" 2>/dev/null | grep -E "conversation|message|----" | head -6

echo
echo "=== перезапуск магазина ==="
systemctl restart narazborku
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://shop.finklass.online/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "  https://shop.finklass.online/health → ${code}"
echo "  админка: $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://shop.finklass.online/app)"
