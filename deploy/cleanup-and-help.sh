#!/bin/bash
set -u
pkill -9 -f "medusa db:migrate" 2>/dev/null || true
pkill -9 -f "npm run predeploy" 2>/dev/null || true
sleep 5
echo "соединений сейчас:"
sudo -u postgres psql -tAc "select count(1) from pg_stat_activity;"
echo "=== нагрузка ==="
uptime
echo "=== опции команды миграции ==="
cd /srv/narazborku/app/apps/backend/.medusa/server
npx medusa db:migrate --help 2>&1 | head -30
