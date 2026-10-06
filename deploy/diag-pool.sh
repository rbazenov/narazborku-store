#!/bin/bash
# Диагностика пула соединений Medusa ↔ PostgreSQL
set -u

pkill -f "medusa db:migrate" 2>/dev/null
pkill -f "npm run predeploy" 2>/dev/null
sleep 4

echo "соединения после остановки миграции:"
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;"

echo "=== где в коде Medusa настраивается пул ==="
grep -rln "databaseDriverOptions" /srv/narazborku/app/node_modules/@medusajs/framework/dist/ 2>/dev/null | head -10

echo "=== фрагмент применения ==="
grep -rn -A8 "databaseDriverOptions" /srv/narazborku/app/node_modules/@medusajs/framework/dist/database/index.js 2>/dev/null | head -30

echo "=== как устроен пул по умолчанию (db-utils) ==="
grep -rn -B3 -A12 "pool" /srv/narazborku/app/node_modules/@medusajs/framework/dist/database/db-utils.js 2>/dev/null | head -40

echo "=== временный конфиг после сборки ==="
ls -la /srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js
head -40 /srv/narazborku/app/apps/backend/.medusa/server/medusa-config.js
