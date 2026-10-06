#!/bin/bash
# Диагностика и правка лимитов PostgreSQL для магазина на малом сервере
set -u

echo "=== до правки ==="
sudo -u postgres psql -tAc "show max_connections;"
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;" 2>&1 | head -1

pkill -f "medusa db:migrate" 2>/dev/null || true
pkill -f "npm run predeploy" 2>/dev/null || true
sleep 2

echo "=== применяю новые лимиты ==="
sudo -u postgres psql -q -c "ALTER SYSTEM SET max_connections = 150;"
sudo -u postgres psql -q -c "ALTER SYSTEM SET shared_buffers = '192MB';"
sudo -u postgres psql -q -c "ALTER SYSTEM SET effective_cache_size = '640MB';"
sudo -u postgres psql -q -c "ALTER SYSTEM SET work_mem = '6MB';"
systemctl restart postgresql
sleep 5

echo "=== после правки ==="
sudo -u postgres psql -tAc "show max_connections;"
sudo -u postgres psql -tAc "show shared_buffers;"
sudo -u postgres psql -tAc "select count(*) from pg_stat_activity;"
systemctl is-active postgresql
